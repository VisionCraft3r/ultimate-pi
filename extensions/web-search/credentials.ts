import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "../../lib/agent-dir.ts";

export type WebSearchCredentials = {
  apiKey: string;
  cseId: string;
};

const API_KEY_ENV = ["GOOGLE_SEARCH_API_KEY", "GOOGLE_API_KEY"] as const;
const CSE_ID_ENV = ["GOOGLE_CSE_ID", "GOOGLE_CUSTOM_SEARCH_ENGINE_ID"] as const;
const API_KEY_JSON = ["google_search_api_key", "apiKey", "api_key", "GOOGLE_SEARCH_API_KEY", "GOOGLE_API_KEY"] as const;
const CSE_ID_JSON = ["google_cse_id", "cseId", "cse_id", "cx", "GOOGLE_CSE_ID", "GOOGLE_CUSTOM_SEARCH_ENGINE_ID"] as const;

function nonempty(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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
      cseId: firstField(record, CSE_ID_JSON),
    };
  } catch {
    return {};
  }
}

export function loadCredentials(): WebSearchCredentials | undefined {
  let apiKey = firstEnv(API_KEY_ENV);
  let cseId = firstEnv(CSE_ID_ENV);
  if (!apiKey || !cseId) {
    const fromFile = credentialsFromAuthFile();
    apiKey = apiKey ?? fromFile.apiKey;
    cseId = cseId ?? fromFile.cseId;
  }
  if (!apiKey || !cseId) return undefined;
  return { apiKey, cseId };
}
