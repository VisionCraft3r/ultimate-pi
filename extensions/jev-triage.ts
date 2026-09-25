import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { isContinuationCrumb, normalizePrompt } from "../lib/continuation-crumbs.ts";
import { resolveOpenRouterApiKey } from "../lib/openrouter-auth.ts";
import { resolveJevEndpoint, resolveJevModel } from "../lib/jev-config.ts";
import { formatFailSoftTier0 } from "../lib/jev-heuristic.ts";

const CONTINUATION_PREFIX =
  /^(alright|all right|one more|also[, ]|instead |note |now,|now what|ok so |and also)\b/;

const PRIOR_REQUEST_MAX = 800;
const PRIOR_ATTACH_MAX = 240;
const PRIOR_ATTACH_CONTINUATION_MAX = 500;

function shouldAttachPrior(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (trimmed.length <= PRIOR_ATTACH_MAX) return true;
  const normalized = normalizePrompt(prompt);
  return CONTINUATION_PREFIX.test(normalized) && trimmed.length <= PRIOR_ATTACH_CONTINUATION_MAX;
}

function userMessageText(entry: { type?: string; message?: { role?: string; content?: unknown } }): string {
  if (entry.type !== "message" || entry.message?.role !== "user") return "";
  const content = entry.message.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: string; text: string } => Boolean(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function priorUserRequest(ctx: ExtensionContext | undefined, current: string): string | undefined {
  const entries = ctx?.sessionManager?.getEntries?.() ?? [];
  const currentNorm = normalizePrompt(current);
  const users: string[] = [];
  for (const entry of entries) {
    const text = userMessageText(entry);
    if (text && normalizePrompt(text) !== currentNorm) users.push(text);
  }
  const prior = users.at(-1);
  if (!prior) return undefined;
  return prior.length > PRIOR_REQUEST_MAX ? prior.slice(0, PRIOR_REQUEST_MAX) : prior;
}

function minConfidenceFor(choice: string): number {
  if (choice === "tier_3" || choice === "tier_4_qa") return 70;
  return 50;
}

function triageText(choice: string, confidencePct: number): string {
  if (confidencePct < minConfidenceFor(choice)) {
    return `Triage Result: ${choice}. WARNING: Low confidence (${confidencePct}%). Orchestrator MUST use ask_question to verify this tier.`;
  }
  return `Triage Result: ${choice} (Confidence: ${confidencePct}%). Proceed with AGENTS.md routing.`;
}

const CONTINUATION_FOCUS = "If prior_request is set, treat `request` as a continuation of that work unless `request` clearly starts a new job. Short ship/proceed crumbs without a new feature are the same job. Do not guess line counts, file counts, or repo layout. Tool launch, provider-key, and spawn-engine errors are configuration talk, not a project-file edit. 'I have a bug' / an agent cannot click or upload is investigation of existing product code, not a QA session.";

/**
 * QA is a separate noul so the word "click" cannot steal a bug into tier_4_qa.
 * Choice is only tier_0..tier_3. Code composes the public routing key.
 */
const TRIAGE_QUESTIONS = {
  is_ui_test: {
    type: "noul",
    instructions: {
      question: "Is the primary deliverable of `request` operating a running product UI, browser, or simulator to verify behavior?",
      focus: CONTINUATION_FOCUS,
    },
    criteria: {
      true: {
        what: "The user wants the agent to drive a running app — click through a product UI, use a browser against live software, or run a simulator — and report whether it works.",
        not_for: "Bug reports that mention clicking, asking where to click, production forensics, shipping or updating an app, implementing, or planning.",
        examples: [
          "click through the checkout flow and confirm payment succeeds",
          "test the login page in the browser",
          "run the iOS simulator and confirm onboarding",
          "take over my browser and do it yourself",
        ],
      },
      false: {
        what: "Anything else: a broken click, a how-to, a live incident, a ship/update, a code change, or a short 'check if it works' after work already in this thread.",
        not_for: "A dedicated QA/verification session against a running UI.",
        examples: [
          "when I click the agent link I get an empty list",
          "where do I click in the admin dashboard",
          "connect to production and check why the payment did not activate",
          "update the app",
          "make sure that's not a bug because an agent had to click that button many times",
          "check if the settings page reloads nicely",
        ],
      },
    },
  },
  task_tier: {
    type: "choice",
    instructions: {
      question: "Which execution route does `request` require?",
      focus: CONTINUATION_FOCUS,
    },
    criteria: {
      tier_0: {
        what: "Talk, explain, configure the tool (launch, keys, spawn engine), look up docs, business stats with no code change, how-to/where-to-click, a status check of work already done, or a same-thread ship crumb.",
        not_for: "Any request to change project code, find files in the repo, design a system, or investigate a live product bug.",
        examples: [
          "what model are we using?",
          "the CLI doesn't launch, see why",
          "I got a triage fallback saying the API key is missing",
          "check if our partners submitted new requests today please",
          "analyse my business and the stats and give me suggestions",
          "where do I click in the dashboard for the export check",
          "so what do you think of my system?",
          "were these implemented, check the code and if it's live",
          "push commit and send to production",
        ],
      },
      tier_1: {
        what: "A bounded project edit whose target is already named or obvious: one file, one function, a typo, or a specific error.",
        not_for: "Unknown location, production forensics, multi-area changes, new systems, or a how-to.",
        examples: [
          "fix the typo in src/auth.ts line 40",
          "rename getUser to fetchUser in api.ts",
          "the TypeError on line 88 of webhook.ts",
        ],
      },
      tier_2: {
        what: "A bug or tweak to existing code whose files are not fully named: unnamed UI copy, a broken click, an agent report, or a production forensic (named customer/agent, live incident, admin/app not loading).",
        not_for: "A named local fix, a new subsystem or architecture, or a how-to with no code change.",
        examples: [
          "when I click the agent link I get an empty list",
          "one of my agents can't upload the file, make sure it's fixed",
          "I have a bug in the app if the same client has a new order",
          "make sure it doesn't open a white page for one of my agents",
          "check the server, the admin is not loading, it's slow to login",
          "I don't paste an IP but I want to open a lead and click the blacklist button",
          "beautify the 404 page, push and commit and send to production when done",
          "improve our system so that new imports happen every 5 minutes",
          "a customer uploaded a document but it's not showing, investigate",
        ],
      },
      tier_3: {
        what: "A new subsystem, architectural refactor, new page/surface, or an explicit ask to write a plan / spec before implementation.",
        not_for: "A tweak or bugfix to an existing flow (including research-then-fix on messaging/queue/copy), a named local fix, or a how-to.",
        examples: [
          "build a page for customers to order a custom report",
          "create a plan for these improvements",
          "plan a fix for these issues, make our system faster",
          "dig deep and research the best way to build a sales slide desk",
          "redesign the admin landing page using Mobbin",
        ],
      },
    },
  },
} as const;

const UI_TEST_NOUL_THRESHOLD = 0.75;
const UI_TEST_CONFIDENCE_THRESHOLD = 0.7;
const AUTO_FETCH_TIMEOUT_MS = 15_000;

/** Env / session toggle. Default ON so triage always runs without model compliance. */
function envAutoEnabled(): boolean {
  const v = process.env.ULTIMATE_PI_JEV_AUTO?.trim().toLowerCase();
  if (!v) return true;
  return !["0", "false", "off", "no"].includes(v);
}

async function runTriage(
  prompt: string,
  ctx: ExtensionContext | undefined,
  signal?: AbortSignal,
): Promise<string> {
  if (isContinuationCrumb(prompt)) {
    return triageText("tier_0", 100);
  }

  const apiKey = resolveOpenRouterApiKey();
  if (!apiKey) {
    return formatFailSoftTier0("no API key — run ultimate-pi setup jev / set TYPESAFE_API_KEY");
  }

  const prior = shouldAttachPrior(prompt) ? priorUserRequest(ctx, prompt) : undefined;
  const state = prior ? { request: prompt, prior_request: prior } : { request: prompt };

  try {
    const response = await fetch(resolveJevEndpoint(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: resolveJevModel(),
        state,
        questions: TRIAGE_QUESTIONS,
      }),
      signal,
    });

    if (!response.ok) throw new Error(`API returned HTTP ${response.status}`);
    const data = await response.json();
    const uiTest = data.answers?.is_ui_test;
    const answer = data.answers?.task_tier;

    const noul = typeof uiTest?.noul === "number" ? uiTest.noul : 0;
    const noulConf = typeof uiTest?.confidence === "number" ? uiTest.confidence : undefined;
    const noulConfident = noulConf === undefined || noulConf >= UI_TEST_CONFIDENCE_THRESHOLD;
    if (noul >= UI_TEST_NOUL_THRESHOLD && noulConfident) {
      const confidencePct = Math.round((noulConf ?? noul) * 100);
      return triageText("tier_4_qa", confidencePct);
    }

    if (!answer || !answer.choice) {
      return formatFailSoftTier0("malformed API response");
    }

    const confidencePct = Math.round((answer.confidence || 0) * 100);
    return triageText(answer.choice, confidencePct);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return formatFailSoftTier0("auto-triage timeout");
    }
    const reason = err instanceof Error ? err.message : String(err);
    return formatFailSoftTier0(`network error: ${reason}`);
  }
}

function shouldAutoTriage(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (!trimmed) return false;
  // Slash commands / bang-shell — not routing work
  if (trimmed.startsWith("/") || trimmed.startsWith("!")) return false;
  return true;
}

export default function (pi: ExtensionAPI) {
  let autoEnabled = envAutoEnabled();
  let evaluating = false;

  pi.registerCommand("jev-auto", {
    description: "Toggle automatic JEV triage before every user turn (ULTIMATE_PI_JEV_AUTO)",
    handler: async (args, ctx) => {
      const a = (args ?? "").trim().toLowerCase();
      if (a === "on" || a === "true" || a === "1") autoEnabled = true;
      else if (a === "off" || a === "false" || a === "0") autoEnabled = false;
      else autoEnabled = !autoEnabled;
      const msg = autoEnabled ? "JEV auto-triage ON" : "JEV auto-triage OFF";
      if (ctx.hasUI) ctx.ui.notify(msg, "info");
      else console.log(msg);
    },
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!autoEnabled || evaluating || !shouldAutoTriage(event.prompt)) return undefined;

    evaluating = true;
    let resultText: string;
    try {
      const signal =
        typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
          ? AbortSignal.timeout(AUTO_FETCH_TIMEOUT_MS)
          : undefined;
      resultText = await runTriage(event.prompt, ctx, signal);
    } finally {
      evaluating = false;
    }

    if (ctx.hasUI) {
      const short = resultText.split(".")[0] ?? resultText;
      ctx.ui.notify(`JEV auto: ${short}`, "info");
    }

    return {
      message: {
        customType: "jev_auto_triage",
        content: resultText,
        display: true,
        details: { source: "before_agent_start", auto: true },
      },
      systemPrompt:
        event.systemPrompt +
        `\n\n## JEV auto-triage (already run — do NOT call jev_triage again this turn)\n${resultText}\nObey AGENTS.md routing for this tier. Only call \`jev_triage\` again if the user clearly changes the job mid-turn.\n`,
    };
  });

  pi.registerTool({
    name: "jev_triage",
    label: "JEV Triage Gateway",
    description:
      "Classifies the user's exact request into a routing tier (tier_0, tier_1, tier_2, tier_3, tier_4_qa). Pass the user's wording verbatim — do not rewrite it. Usually unnecessary: auto-triage runs on before_agent_start. Use only to re-classify mid-turn.",
    parameters: Type.Object({
      prompt: Type.String({ description: "The user's exact request string, verbatim" }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const text = await runTriage(params.prompt, ctx, signal);
      return { content: [{ type: "text", text }], details: {} };
    },
  });
}
