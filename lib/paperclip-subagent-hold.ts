/**
 * Keep a Paperclip --print run inside agent_before_settle while tmux subagents
 * are still working. A new parent steer (question or result) ends the wait so
 * the same run can continue. Local pi has no PAPERCLIP_RUN_ID, so it does not wait.
 */

export const RUNNING_CHILDREN_COUNT_KEY = Symbol.for("pi-subagents/running-children-count");
export const PARENT_WAKE_SEQ_KEY = Symbol.for("pi-subagents/parent-wake-seq");

export function runningSubagentCount(): number {
  const read = (globalThis as Record<symbol, unknown>)[RUNNING_CHILDREN_COUNT_KEY];
  if (typeof read !== "function") return 0;
  const count = Number(read());
  return Number.isFinite(count) && count > 0 ? count : 0;
}

export function parentWakeSeq(): number {
  const state = (globalThis as Record<symbol, unknown>)[PARENT_WAKE_SEQ_KEY] as { n?: unknown } | undefined;
  return typeof state?.n === "number" && Number.isFinite(state.n) ? state.n : 0;
}

export function shouldHoldSubagents(input: { paperclip: boolean; running: number }): boolean {
  return input.paperclip && input.running > 0;
}

export async function waitForSubagentWake(options?: {
  paperclip?: boolean;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  running?: () => number;
  seq?: () => number;
}): Promise<"idle" | "woke"> {
  const paperclip = options?.paperclip ?? Boolean(process.env.PAPERCLIP_RUN_ID);
  const running = options?.running ?? runningSubagentCount;
  const seq = options?.seq ?? parentWakeSeq;
  const start = seq();
  if (!shouldHoldSubagents({ paperclip, running: running() })) return "idle";
  const sleep = options?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const interval = options?.intervalMs ?? 200;
  while (seq() === start) await sleep(interval);
  return "woke";
}
