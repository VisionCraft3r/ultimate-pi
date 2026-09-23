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
