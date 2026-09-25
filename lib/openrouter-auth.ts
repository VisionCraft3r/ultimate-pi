import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { getAgentDir } from "./agent-dir.ts";

/**
 * API key for JEV tools.
 * Prefer TypeSafe direct key (TYPESAFE_API_KEY / jev_api_key), then OpenRouter.
 * OPENROUTER_API_KEY still supported for OpenRouter Decisions API fallback.
 *
 * Keep this file outside extensions/*.ts — PI auto-loads every
 * top-level .ts there as an extension factory and exits if there is none.
 */

function loadAgentEnv(): void {
  // Pi does not always load <agentDir>/.env into process.env. Seed JEV-related
  // keys once so TypeSafe direct auth works when the shell only exported OPENROUTER_*.
  const path = join(getAgentDir(), ".env");
  if (!existsSync(path)) return;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    const name = trimmed.slice(0, eq).trim();
    if (!/^(TYPESAFE_|JEV_|ULTIMATE_PI_JEV_|OPENROUTER_)/i.test(name)) continue;
    if (process.env[name]?.trim()) continue; // do not override explicit shell exports
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) process.env[name] = value;
  }
}

function jevUsesTypesafeDirect(): boolean {
  const endpoint =
    process.env.ULTIMATE_PI_JEV_ENDPOINT?.trim() ||
    "https://openrouter.ai/api/alpha/decisions";
  return /api\.typesafe\.ai/i.test(endpoint);
}

export function resolveOpenRouterApiKey(): string | undefined {
  loadAgentEnv();

  const typesafeDirect = jevUsesTypesafeDirect();

  const envNames = typesafeDirect
    ? ["TYPESAFE_API_KEY", "JEV_API_KEY", "jev_api_key"]
    : ["TYPESAFE_API_KEY", "JEV_API_KEY", "jev_api_key", "OPENROUTER_API_KEY"];

  for (const name of envNames) {
    const fromEnv = process.env[name]?.trim();
    if (fromEnv) return fromEnv;
  }

  try {
    const data = JSON.parse(readFileSync(join(getAgentDir(), "auth.json"), "utf8")) as {
      typesafe?: { key?: unknown };
      jev?: { key?: unknown };
      openrouter?: { key?: unknown };
    };
    const entries = typesafeDirect
      ? [data.typesafe, data.jev]
      : [data.typesafe, data.jev, data.openrouter];
    for (const entry of entries) {
      const key = entry?.key;
      if (typeof key === "string" && key.trim()) return key.trim();
    }
  } catch {
    // ignore
  }
  return undefined;
}
