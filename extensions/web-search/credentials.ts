import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "../../lib/agent-dir.ts";

export type WebSearchCredentials = { apiKey: string };

const API_KEY_ENV = ["TAVILY_API_KEY"] as const;
const API_KEY_JSON = ["tavily_api_key", "apiKey", "api_key", "TAVILY_API_KEY"] as const;
const PLACEHOLDER = "your-tavily-api-key-here";

function nonempty(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed !== PLACEHOLDER ? trimmed : undefined;
}

function firstEnv(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = nonempty(process.env[name]);
    if (value) return value;
  }
  return undefined;
}

function firstField(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = nonempty(record[key]);
    if (value) return value;
  }
  return undefined;
}

export function resolveAuthPath(): string {
  return join(getAgentDir(), "extensions", "web-search", "auth.json");
}

function credentialsFromAuthFile(): Partial<WebSearchCredentials> {
  try {
    const raw = readFileSync(resolveAuthPath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    return {
      apiKey: firstField(record, API_KEY_JSON),
    };
  } catch {
    return {};
  }
}

export function loadCredentials(): WebSearchCredentials | undefined {
  const apiKey = firstEnv(API_KEY_ENV) ?? credentialsFromAuthFile().apiKey;
  return apiKey ? { apiKey } : undefined;
}
