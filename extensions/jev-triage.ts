import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { isContinuationCrumb, normalizePrompt } from "../lib/continuation-crumbs.ts";
import { resolveOpenRouterApiKey } from "../lib/openrouter-auth.ts";
import { jevFailureReason, jevRequestSignal, resolveJevEndpoint, resolveJevModel } from "../lib/jev-config.ts";
import { formatHeuristicTriage } from "../lib/jev-heuristic.ts";
import { formatVerification, verificationFromChoice, type Verification } from "../lib/jev-verify.ts";
import { traceEvent } from "../lib/trace.ts";

function noteTriage(source: string, tier: string, confidence?: number): void {
  traceEvent("jev-triage", { source, tier, confidence: confidence ?? null });
}

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
  if (choice === "tier_3" || choice === "tier_4_qa" || choice === "tier_5_review") return 70;
  return 50;
}

function triageText(choice: string, confidencePct: number, verification: Verification): string {
  const check = formatVerification(verification);
  if (confidencePct < minConfidenceFor(choice)) {
    return `Triage Result: ${choice}. WARNING: Low confidence (${confidencePct}%). Orchestrator MUST use ask_question to verify this tier. ${check}`;
  }
  return `Triage Result: ${choice} (Confidence: ${confidencePct}%). ${check} Proceed with AGENTS.md routing.`;
}

const CONTINUATION_FOCUS = "If prior_request is set, treat `request` as a continuation of that work unless `request` clearly starts a new job. Short ship/proceed crumbs without a new feature are the same job. Do not guess line counts, file counts, or repo layout. Tool launch, provider-key, and spawn-engine errors are configuration talk, not a project-file edit. 'I have a bug' / an agent cannot click or upload is investigation of existing product code, not a QA session.";

/**
 * QA is a separate noul so the word "click" cannot steal a bug into tier_4_qa.
 * Choice is only tier_0..tier_3. Code composes the public routing key.
 */
const TRIAGE_QUESTIONS = {
  is_code_review: {
    type: "noul",
    instructions: {
      question: "Is the primary deliverable of `request` a read-only assessment of existing code, with no plan to write and no implementation to do first?",
      focus: CONTINUATION_FOCUS,
    },
    criteria: {
      true: {
        what: "The user wants a code audit, project audit, security review, adversarial review, or a review of a PR or diff, and the deliverable is findings rather than a spec or a code change.",
        not_for: "Writing or approving a spec, a named fix, a bug hunt, a how-to, or driving a running UI. Those stay on their current tiers. A code change is not automatically a code review.",
        examples: [
          "audit the auth module",
          "project audit",
          "security review of this diff",
          "review this PR",
          "adversarial review of src/billing",
        ],
      },
      false: {
        what: "A plan or spec, a local fix, a bug investigation, an explanation, or a live UI session.",
        not_for: "A dedicated read-only code or project audit.",
        examples: [
          "review the plan",
          "create a plan for the billing rewrite",
          "fix the typo in src/auth.ts",
          "when I click submit nothing happens",
          "click through checkout in the browser",
        ],
      },
    },
  },
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
        not_for: "Any request to change project code, find files in the repo, design a system, investigate a live product bug, or audit existing code.",
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
        not_for: "Unknown location, production forensics, multi-area changes, new systems, a how-to, or a read-only code audit.",
        examples: [
          "fix the typo in src/auth.ts line 40",
          "rename getUser to fetchUser in api.ts",
          "the TypeError on line 88 of webhook.ts",
        ],
      },
      tier_2: {
        what: "A bug or tweak to existing code whose files are not fully named: unnamed UI copy, a broken click, an agent report, or a production forensic (named customer/agent, live incident, admin/app not loading).",
        not_for: "A named local fix, a new subsystem or architecture, a how-to with no code change, or a read-only audit.",
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
        not_for: "A tweak or bugfix to an existing flow (including research-then-fix on messaging/queue/copy), a named local fix, a how-to, or a read-only audit of code that already exists.",
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
  verification: {
    type: "choice",
    instructions: {
      question: "After the code change, which extra check does `request` need beyond the tests a worker already runs?",
      focus: "Workers run tests without being asked. Do not pick reviewer because code will change. Pick reviewer only for security, billing, migration, data-loss, or an explicit review of the change. Pick browser when proof is operating a running UI. Pick scout when proof is re-reading core logic. Otherwise tests.",
    },
    criteria: {
      tests: {
        what: "The worker's own runnable check is the verification. No extra agent.",
        not_for: "A UI that must be operated, a logic re-read, or a security/billing/migration review.",
        examples: [
          "fix the typo in src/auth.ts line 40",
          "rename getUser to fetchUser in api.ts",
          "the TypeError on line 88 of webhook.ts",
        ],
      },
      scout: {
        what: "Someone must re-read the changed logic and say whether it matches the brief. Not a line-by-line code review.",
        not_for: "A typo, a running UI, or a security review.",
        examples: [
          "make sure the retry calculation is right",
          "verify the invariant in the scheduler",
          "double-check the core logic of the discount math",
        ],
      },
      browser: {
        what: "The proof is operating a running page, button, or screen after the change.",
        not_for: "A logic-only fix, a typo, or a read-only audit.",
        examples: [
          "when I click submit nothing happens",
          "the login button is broken",
          "make sure it doesn't open a white page",
        ],
      },
      reviewer: {
        what: "The change can lose data, break a payment or auth boundary, migrate stored state, or the user asked for a review of the diff.",
        not_for: "Ordinary fixes, UI checks, or logic re-reads. Tests and a scout cover those.",
        examples: [
          "fix the payment retry so we cannot double charge",
          "review this change for data loss",
          "the billing migration must not drop invoices",
        ],
      },
    },
  },
} as const;

const UI_TEST_NOUL_THRESHOLD = 0.75;
const UI_TEST_CONFIDENCE_THRESHOLD = 0.7;

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "jev_triage",
    label: "JEV Triage Gateway",
    description: "Classifies the user's exact request into a routing tier (tier_0, tier_1, tier_2, tier_3, tier_4_qa, tier_5_review). Pass the user's wording verbatim — do not rewrite it. The tool attaches the previous user turn from the session as prior_request.",
    parameters: Type.Object({
      prompt: Type.String({ description: "The user's exact request string, verbatim" })
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (isContinuationCrumb(params.prompt)) {
        noteTriage("crumb", "tier_0", 100);
        return { content: [{ type: "text", text: triageText("tier_0", 100, "tests") }], details: {} };
      }

      const apiKey = resolveOpenRouterApiKey();
      if (!apiKey) {
        const text = formatHeuristicTriage(params.prompt);
        noteTriage("heuristic", text.match(/Triage Result: (tier_[\w]+)/)?.[1] ?? "unknown");
        return { content: [{ type: "text", text }], details: {} };
      }

      const prior = shouldAttachPrior(params.prompt)
        ? priorUserRequest(ctx, params.prompt)
        : undefined;
      const state = prior
        ? { request: params.prompt, prior_request: prior }
        : { request: params.prompt };

      try {
        const response = await fetch(resolveJevEndpoint(), {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: resolveJevModel(),
            state,
            questions: TRIAGE_QUESTIONS
          }),
          signal: jevRequestSignal(signal),
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
          noteTriage("live", "tier_4_qa", confidencePct);
          return { content: [{ type: "text", text: triageText("tier_4_qa", confidencePct, "browser") }], details: {} };
        }

        const review = data.answers?.is_code_review;
        const reviewNoul = typeof review?.noul === "number" ? review.noul : 0;
        const reviewConf = typeof review?.confidence === "number" ? review.confidence : undefined;
        const reviewConfident = reviewConf === undefined || reviewConf >= UI_TEST_CONFIDENCE_THRESHOLD;
        if (reviewNoul >= UI_TEST_NOUL_THRESHOLD && reviewConfident) {
          const confidencePct = Math.round((reviewConf ?? reviewNoul) * 100);
          noteTriage("live", "tier_5_review", confidencePct);
          return { content: [{ type: "text", text: triageText("tier_5_review", confidencePct, "reviewer") }], details: {} };
        }

        if (!answer || !answer.choice) {
          const text = formatHeuristicTriage(params.prompt, { unavailableReason: "malformed API response" });
          noteTriage("heuristic", text.match(/Triage Result: (tier_[\w]+)/)?.[1] ?? "unknown");
          return { content: [{ type: "text", text }], details: {} };
        }

        const confidencePct = Math.round((answer.confidence || 0) * 100);
        const verifyAnswer = data.answers?.verification;
        const verifyChoice = typeof verifyAnswer?.choice === "string" ? verifyAnswer.choice : undefined;
        const verifyConf = typeof verifyAnswer?.confidence === "number" ? verifyAnswer.confidence : undefined;
        const verification = verificationFromChoice(answer.choice, verifyChoice, verifyConf);
        noteTriage("live", answer.choice, confidencePct);
        return { content: [{ type: "text", text: triageText(answer.choice, confidencePct, verification) }], details: {} };
      } catch (err) {
        const reason = jevFailureReason(err);
        const text = formatHeuristicTriage(params.prompt, { unavailableReason: reason });
        noteTriage(reason === "timeout" ? "timeout" : "heuristic", text.match(/Triage Result: (tier_[\w]+)/)?.[1] ?? "unknown");
        return { content: [{ type: "text", text }], details: {} };
      }
    }
  });
}
