import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fileURLToPath } from "node:url";
import bashGuard from "./bash-guard/index.ts";
import { resolveOpenRouterApiKey } from "../lib/openrouter-auth.ts";
import { installQuotaFallback } from "../lib/quota-fallback.ts";
import { installSoftRoundNudge, WORKER_NUDGE_REASON, workerRoundNudgeLimit } from "../lib/round-budget.ts";
import { VERIFY_GATE_REASON, lastAssistantText, verifyGateAction } from "../lib/verify-gate.ts";
import { jevFailureReason, jevRequestSignal, resolveJevEndpoint, resolveJevModel } from "../lib/jev-config.ts";
import { HEURISTIC_UNCONFIGURED_PREFIX, formatUnavailablePrefix } from "../lib/jev-heuristic.ts";

const THIS_FILE = fileURLToPath(import.meta.url);

function registerForSubagents(name: string, extensionPath: string): void {
  (globalThis as any).__pi_interactive_subagents?.registerToolExtension(name, extensionPath);
}

function isSubagentProcess(): boolean {
  const depth = Number(process.env.PI_SUBAGENT_DEPTH ?? "0");
  return (Number.isFinite(depth) && depth >= 1) || Boolean(process.env.PI_SUBAGENT_ID || process.env.PI_SUBAGENT_AGENT);
}

const DESTRUCTIVE_PATTERN = /(rm\s+-rf|chmod\s+-R\s+777|mkfs|drop\s+table)/i;

/**
 * Local fallback used when no OpenRouter key is configured, or the JEV API
 * call errors. Always applies the hardcoded destructive-command regex first;
 * beyond that it cannot safely infer intent, so it returns a low-confidence
 * "false" (block/require-manual-review) result with a visible warning rather
 * than silently approving.
 */
function heuristicSentinel(state: string, instructions: string, reason?: string): string {
  const prefix = reason ? formatUnavailablePrefix(reason) : HEURISTIC_UNCONFIGURED_PREFIX;
  const looksSafetyRelated = /safe|destructive/i.test(instructions);
  if (looksSafetyRelated && DESTRUCTIVE_PATTERN.test(state)) {
    return `${prefix}\nSentinel Result: false (Confidence: 100%). BLOCKED: Hardcoded regex safety rules triggered before AI evaluation.`;
  }
  return `${prefix}\nSentinel Result: false (Confidence: 30%). Heuristic mode cannot safely evaluate this condition — treat as unverified and confirm manually before proceeding.`;
}

export default function (pi: ExtensionAPI) {
  registerForSubagents("jev_sentinel", THIS_FILE);

  // Parent sessions already load bash-guard via extension discovery. Children
  // only get this file via -e, so install the headless hard-block here.
  if (isSubagentProcess()) {
    if (!process.env.PI_SUBAGENT_DEPTH || process.env.PI_SUBAGENT_DEPTH === "0") {
      process.env.PI_SUBAGENT_DEPTH = "1";
    }
    bashGuard(pi);
  }

  if (process.env.PI_SUBAGENT_AGENT === "worker") {
    const nudgeAt = workerRoundNudgeLimit();
    if (nudgeAt) {
      installSoftRoundNudge(pi, {
        ceiling: nudgeAt,
        reason: WORKER_NUDGE_REASON,
        customType: "worker-round-nudge",
      });
    }

    let verifyNudged = false;
    pi.on("agent_before_settle", (event, ctx) => {
      const settle = event as { outcome?: string; context?: { canContinue?: boolean; sessionManager?: { getEntries?: () => unknown[] } } };
      if (settle.outcome !== "completed" || !settle.context?.canContinue) return;
      const fromCtx = ctx as { sessionManager?: { getEntries?: () => unknown[] } } | undefined;
      const session = fromCtx?.sessionManager?.getEntries ? fromCtx : settle.context;
      const action = verifyGateAction(lastAssistantText(session), verifyNudged);
      if (!action) return;
      verifyNudged = true;
      return {
        continue: true,
        entries: [
          {
            type: "custom_message" as const,
            customType: "verify-gate",
            content: VERIFY_GATE_REASON,
            display: true,
          },
        ],
      };
    });
  }

  installQuotaFallback(pi);

  pi.registerTool({
    name: "jev_sentinel",
    label: "JEV Safety Sentinel",
    description: "Evaluates a True/False condition without generating text. Use for validating step success or command safety.",
    parameters: Type.Object({
      state: Type.String({ description: "Text to evaluate (e.g., DOM text or command)" }),
      instructions: Type.String({ description: "The yes/no question to ask" }),
      true_criteria: Type.String({ description: "What constitutes a 'true' answer" }),
      false_criteria: Type.String({ description: "What constitutes a 'false' answer" })
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (params.instructions.toLowerCase().includes("safe") || params.instructions.toLowerCase().includes("destructive")) {
        if (DESTRUCTIVE_PATTERN.test(params.state)) {
           return { content: [{ type: "text", text: "Sentinel Result: false (Confidence: 100%). BLOCKED: Hardcoded regex safety rules triggered before AI evaluation." }], details: {} };
        }
      }

      const apiKey = resolveOpenRouterApiKey();
      if (!apiKey) {
        return { content: [{ type: "text", text: heuristicSentinel(params.state, params.instructions) }], details: {} };
      }

      try {
        const response = await fetch(resolveJevEndpoint(), {
          method: "POST",
          signal: jevRequestSignal(signal),
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: resolveJevModel(),
            state: params.state,
            questions: {
              evaluation: {
                type: "noul",
                instructions: params.instructions,
                criteria: {
                  "true": params.true_criteria,
                  "false": params.false_criteria
                }
              }
            }
          })
        });

        if (!response.ok) throw new Error(`API returned HTTP ${response.status}`);
        const data = await response.json();
        const answer = data.answers?.evaluation;
        if (!answer) {
          return { content: [{ type: "text", text: heuristicSentinel(params.state, params.instructions, "malformed API response") }], details: {} };
        }

        const confidencePct = Math.round((answer.confidence || 0) * 100);
        return { content: [{ type: "text", text: `Sentinel Result: ${answer.choice} (Confidence: ${confidencePct}%).` }], details: {} };
      } catch (err) {
        return { content: [{ type: "text", text: heuristicSentinel(params.state, params.instructions, jevFailureReason(err)) }], details: {} };
      }
    }
  });
}
