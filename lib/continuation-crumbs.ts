/**
 * Ship/follow-up crumbs shared by jev-triage and pi-graft.
 * Keep this file outside extensions/*.ts — PI auto-loads every
 * top-level .ts there as an extension factory and exits if there is none.
 */

const CONTINUATION_CRUMBS = [
  "push to production",
  "push to produciton",
  "push to ptoduction",
  "push to prod",
  "push live",
  "push commit and send to production",
  "push commit and send t production",
  "push and commit and send to production",
  "push and execute on production",
  "document push and commit",
  "update the app",
  "implement safely on production",
  "psuh to production",
  "ship this",
  "shiped",
  "shipped",
] as const;

const CONTINUE_EXACT = new Set([
  "proceed",
  "keep going",
  "try again",
  "go ahead",
  "continue",
]);

const SHIP_PHRASES = [
  "document push and commit",
  "push commit and send",
  "push and commit",
  "push and execute",
  "push to production",
  "psuh to production",
  "push to produciton",
  "push to ptoduction",
  "push to prod",
  "push live",
  "send to production",
  "send t production",
  "ship to production",
  "ship to ptoduction",
  "on production",
  "to production",
  "to produciton",
  "to ptoduction",
  "to prod",
  "when done",
  "make sure",
  "push commit",
] as const;

const SHIP_TOKENS = new Set([
  "push",
  "psuh",
  "bush",
  "pushed",
  "commit",
  "commmit",
  "commitment",
  "send",
  "sent",
  "ship",
  "shiped",
  "shipped",
  "production",
  "produciton",
  "ptoduction",
  "prod",
  "live",
  "document",
  "documents",
  "documented",
  "execute",
  "deploy",
  "activate",
]);

const SHIP_STOP = new Set([
  "a", "an", "the", "this", "that", "it", "to", "t", "on", "and", "then", "when",
  "done", "please", "well", "everything", "verything", "we", "did", "is", "are",
  "of", "also", "now", "ok", "okay", "our", "for", "me", "you", "your", "my",
  "so", "just", "if", "its", "with", "as", "be", "been", "was", "were", "i",
  "im", "give", "link", "url", "after", "already", "safely", "fast", "them",
  "these", "those", "in",
]);

const SHIP_ONLY_MAX = 110;

export function normalizePrompt(prompt: string): string {
  return prompt
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\s.!?]+$/g, "")
    .replace(/^please\s+/, "");
}

function isExactCrumb(normalized: string): boolean {
  if (CONTINUE_EXACT.has(normalized)) return true;
  for (const crumb of CONTINUATION_CRUMBS) {
    if (normalized === crumb) return true;
    if (normalized.startsWith(`${crumb} `) && normalized.length <= crumb.length + 32) return true;
  }
  return false;
}

function hasShipSignal(normalized: string): boolean {
  if (SHIP_PHRASES.some((phrase) => normalized.includes(phrase))) return true;
  return normalized.split(/[^a-z0-9']+/).some((token) => SHIP_TOKENS.has(token));
}

function leftoverAfterShip(normalized: string): string[] {
  let work = ` ${normalized} `;
  const phrases = [...SHIP_PHRASES].sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    work = work.replaceAll(` ${phrase} `, " ");
  }
  return work
    .split(/[^a-z0-9']+/)
    .filter((token) => token && !SHIP_STOP.has(token) && !SHIP_TOKENS.has(token));
}

function isImplementPlanShip(normalized: string): boolean {
  if (normalized.length > 120) return false;
  if (!normalized.includes("implement the plan")) return false;
  return hasShipSignal(normalized);
}

function isShipOnlyShort(prompt: string): boolean {
  const normalized = normalizePrompt(prompt);
  if (normalized.length > SHIP_ONLY_MAX) return false;
  if (!hasShipSignal(normalized)) return false;
  return leftoverAfterShip(normalized).length === 0;
}

export function isContinuationCrumb(prompt: string): boolean {
  const normalized = normalizePrompt(prompt);
  if (isExactCrumb(normalized)) return true;
  if (isImplementPlanShip(normalized)) return true;
  return isShipOnlyShort(prompt);
}
