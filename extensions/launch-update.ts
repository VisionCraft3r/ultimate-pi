import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isSubagentSession, runLaunchUpdate, SUBAGENT_SYNC_DEFER } from "../lib/launch-update.ts";

let started = false;
const SYNC_RETRY_MS = 60_000;
const SYNC_RETRY_LIMIT = 4;

export default function launchUpdate(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (started || isSubagentSession()) return;
    started = true;
    // hashTree runs until the first await. Leave that off the startup turn.
    const report = (notes: string[]) => {
      const summary = notes.filter((note) => !note.includes("already installed")).join("\n");
      if (summary && ctx.hasUI) {
        try {
          ctx.ui.notify(summary, "info");
        } catch {
          // The session may already have been replaced.
        }
      }
      if (summary) process.stderr.write(`[ultimate-pi] ${summary.replaceAll("\n", " | ")}\n`);
    };
    const runOnce = (attempt: number) => {
      void runLaunchUpdate()
        .then((notes) => {
          report(notes);
          const deferred = notes.some((note) => note.includes(SUBAGENT_SYNC_DEFER));
          if (deferred && attempt + 1 < SYNC_RETRY_LIMIT) {
            setTimeout(() => runOnce(attempt + 1), SYNC_RETRY_MS);
          }
        })
        .catch((err) => {
          process.stderr.write(`[ultimate-pi] update check failed: ${err instanceof Error ? err.message : String(err)}\n`);
        });
    };
    setTimeout(() => runOnce(0), 0);
  });
}
