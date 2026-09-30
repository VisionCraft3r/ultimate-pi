import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isSubagentSession, runLaunchUpdate } from "../lib/launch-update.ts";

let started = false;

export default function launchUpdate(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (started || isSubagentSession()) return;
    started = true;
    // hashTree runs until the first await. Leave that off the startup turn.
    setTimeout(() => {
      void runLaunchUpdate()
        .then((notes) => {
          const summary = notes
            .filter((note) => !note.includes("already installed"))
            .join("\n");
          if (summary && ctx.hasUI) ctx.ui.notify(summary, "info");
          if (summary) process.stderr.write(`[ultimate-pi] ${summary.replaceAll("\n", " | ")}\n`);
        })
        .catch((err) => {
          process.stderr.write(`[ultimate-pi] update check failed: ${err instanceof Error ? err.message : String(err)}\n`);
        });
    }, 0);
  });
}
