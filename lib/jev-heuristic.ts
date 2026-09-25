/**
 * Local fallback classifier used when no OpenRouter key is configured, or when
 * the JEV API call errors. This is NOT the TypeSafe AI JEV model.
 */

import { isContinuationCrumb, normalizePrompt } from "./continuation-crumbs.ts";

export type HeuristicTier = "tier_0" | "tier_1" | "tier_2" | "tier_3" | "tier_4_qa";

/** Visible marker so orchestrators never confuse this with a real JEV result. */
export const HEURISTIC_UNCONFIGURED_PREFIX =
  "⚠ JEV not configured — heuristic routing (run `ultimate-pi setup jev`).";

export const HEURISTIC_MAX_CONFIDENCE = 60;

const NAMED_FILE =
  /\b[\w./-]+\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|py|go|rs|java|kt|rb|php|css|scss|html|md|json|yml|yaml|toml|sql|sh|vue|svelte)\b/i;
const NAMED_FN = /\b[A-Za-z_][\w]*\s*\(/;
const UI_CONTEXT = /\b(browser|simulator|click[\s-]*through|e2e|visually\s+verify)\b/i;
const UI_VERB = /\b(click|tap|test|verify|confirm|drive|operate|screenshot|navigate|run)\b/i;
const PLAN_LIKE =
  /\b(plan|architecture|design|spec)\b|\bnew\s+(system|subsystem|service)\b/i;
const BUG_LIKE =
  /\b(bug|broken|error|doesn't work|does not work|doesnt work|when i click)\b/i;
const QUESTION_LIKE =
  /^(what|why|how|where|who|which|is|are|can|should|does|do)\b|\bhow to\b|\bconfigur/;

export function minConfidenceFor(choice: string): number {
  if (choice === "tier_3" || choice === "tier_4_qa") return 70;
  return 50;
}

export function formatTriageResult(choice: string, confidencePct: number): string {
  if (confidencePct < minConfidenceFor(choice)) {
    return `Triage Result: ${choice}. WARNING: Low confidence (${confidencePct}%). Orchestrator MUST use ask_question to verify this tier.`;
  }
  return `Triage Result: ${choice} (Confidence: ${confidencePct}%). Proceed with AGENTS.md routing.`;
}

export function classifyHeuristic(prompt: string): { tier: HeuristicTier; confidence: number } {
  const normalized = normalizePrompt(prompt);
  const cap = HEURISTIC_MAX_CONFIDENCE;

  if (isContinuationCrumb(prompt)) return { tier: "tier_0", confidence: cap };

  if (UI_CONTEXT.test(normalized) && UI_VERB.test(normalized)) {
    return { tier: "tier_4_qa", confidence: cap };
  }

  if (PLAN_LIKE.test(normalized)) return { tier: "tier_3", confidence: cap };

  const hasFile = NAMED_FILE.test(prompt);
  if (BUG_LIKE.test(normalized) && !hasFile) return { tier: "tier_2", confidence: cap };

  if (hasFile || NAMED_FN.test(prompt) || /\btypos?\b/i.test(normalized)) {
    return { tier: "tier_1", confidence: cap };
  }

  if (/\?$/.test(normalized) || QUESTION_LIKE.test(normalized)) {
    return { tier: "tier_0", confidence: cap };
  }

  return { tier: "tier_1", confidence: 45 };
}

export function formatUnavailablePrefix(reason: string): string {
  return `⚠ JEV unavailable (${reason}).`;
}

/**
 * When live JEV cannot be reached, do not keyword-escalate into tier_1+.
 * Stay in main (tier_0) so a 401/timeout cannot spawn planner/worker by accident.
 */
export function formatFailSoftTier0(reason: string): string {
  return (
    `${formatUnavailablePrefix(reason)} Fail-soft: tier_0 — answer in main, do not spawn. ` +
    `Re-run triage only if routing is clearly wrong.\n` +
    formatTriageResult("tier_0", 100)
  );
}

export function formatHeuristicTriage(
  prompt: string,
  options?: { unavailableReason?: string },
): string {
  const { tier, confidence } = classifyHeuristic(prompt);
  const prefix = options?.unavailableReason
    ? formatUnavailablePrefix(options.unavailableReason)
    : HEURISTIC_UNCONFIGURED_PREFIX;
  return `${prefix}\n${formatTriageResult(tier, confidence)}`;
}
