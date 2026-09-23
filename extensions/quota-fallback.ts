/**
 * Auto-switch model on HTTP 429 (provider consumption gone).
 *
 * Parent sessions load this via extension discovery. Children launch with
 * --no-extensions; we piggyback on the always-granted `ask_question` allowlist
 * name so spawn adds `-e` this file. Do not register ask_question here —
 * subagent-done.ts already does.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import { installQuotaFallback, deriveDefaultChains } from "../lib/quota-fallback.ts";
import { listConfiguredProviders } from "../lib/model-agents.ts";

const THIS_FILE = fileURLToPath(import.meta.url);

function registerForSubagents(name: string, extensionPath: string): void {
  const register = (globalThis as any).__pi_interactive_subagents?.registerToolExtension;
  if (typeof register !== "function") return;
  try {
    register(name, extensionPath);
  } catch {
    // already bound to this path, or another extension claimed the name
  }
}

export default function quotaFallback(pi: ExtensionAPI) {
  // Factory order can beat pi-interactive-subagents; session_start is after
  // that global is set, so children spawned later get `-e` this file.
  registerForSubagents("ask_question", THIS_FILE);
  pi.on("session_start", () => {
    registerForSubagents("ask_question", THIS_FILE);
  });

  const derivedDefaults = deriveDefaultChains(listConfiguredProviders());
  installQuotaFallback(pi, derivedDefaults);
}
