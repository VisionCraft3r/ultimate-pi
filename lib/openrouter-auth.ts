import { join } from "node:path";
import { readFileSync } from "node:fs";
import { getAgentDir } from "./agent-dir.ts";

/**
 * OpenRouter key for JEV tools. PI stores provider keys in auth.json;
 * OPENROUTER_API_KEY is optional and wins if set.
 *
 * Keep this file outside extensions/*.ts — PI auto-loads every
 * top-level .ts there as an extension factory and exits if there is none.
 */
export function resolveOpenRouterApiKey(): string | undefined {
  const fromEnv = process.env.OPENROUTER_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  try {
    const data = JSON.parse(readFileSync(join(getAgentDir(), "auth.json"), "utf8")) as {
      openrouter?: { key?: unknown };
    };
    const key = data.openrouter?.key;
    return typeof key === "string" && key.trim() ? key.trim() : undefined;
  } catch {
    return undefined;
  }
}
