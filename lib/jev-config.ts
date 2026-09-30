/** Default JEV model id (TypeSafe AI via OpenRouter). Overridable. */
export const JEV_MODEL = process.env.ULTIMATE_PI_JEV_MODEL ?? "typesafe/jev-1.13";

/** Default JEV decisions endpoint. Overridable. */
export const JEV_ENDPOINT =
  process.env.ULTIMATE_PI_JEV_ENDPOINT ?? "https://openrouter.ai/api/alpha/decisions";

export function resolveJevModel(): string {
  return process.env.ULTIMATE_PI_JEV_MODEL?.trim() || JEV_MODEL;
}

export function resolveJevEndpoint(): string {
  return process.env.ULTIMATE_PI_JEV_ENDPOINT?.trim() || JEV_ENDPOINT;
}

/** Default deadline for a live JEV call. A hung endpoint must not stall routing. */
export const DEFAULT_JEV_TIMEOUT_MS = 8_000;

export function resolveJevTimeoutMs(): number {
  const raw = process.env.ULTIMATE_PI_JEV_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_JEV_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_JEV_TIMEOUT_MS;
  return Math.floor(parsed);
}

/** Tool cancellation plus the JEV deadline. Whichever fires first aborts the fetch. */
export function jevRequestSignal(toolSignal?: AbortSignal, timeoutMs = resolveJevTimeoutMs()): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!toolSignal) return timeout;
  return AbortSignal.any([toolSignal, timeout]);
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Map a failed JEV fetch onto the visible heuristic warning reason. */
export function jevFailureReason(err: unknown): string {
  const name = errorName(err);
  const message = errorMessage(err);
  const cause = err instanceof Error ? (err as { cause?: unknown }).cause : undefined;
  const timedOut =
    name === "TimeoutError" ||
    errorName(cause) === "TimeoutError" ||
    /timeout/i.test(message) ||
    /timeout/i.test(errorMessage(cause));
  if (timedOut) return "timeout";
  if (name === "AbortError") return "cancelled";
  return `network error: ${message}`;
}
