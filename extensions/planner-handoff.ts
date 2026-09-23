/**
 * Planner spec-ready handoff. Parent discovery loads this factory so
 * registerToolExtension("handoff_spec") can add `-e` this file to planner
 * children (`--no-extensions`). Do not register ask_question here.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import { installPlannerHandoff } from "../lib/planner-handoff.ts";

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

export default function plannerHandoff(pi: ExtensionAPI) {
  registerForSubagents("handoff_spec", THIS_FILE);
  pi.on("session_start", () => {
    registerForSubagents("handoff_spec", THIS_FILE);
  });
  installPlannerHandoff(pi);
}
