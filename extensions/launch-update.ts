import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runLaunchUpdate } from "../lib/launch-update.ts";

let started = false;

export default function launchUpdate(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (started) return;
    started = true;
    try {
      const notes = await runLaunchUpdate();
      const summary = notes.filter((note) => !note.includes("already installed")).join("\n");
      if (summary && ctx.hasUI) ctx.ui.notify(summary, "info");
      if (summary) process.stderr.write(`[ultimate-pi] ${summary.replaceAll("\n", " | ")}\n`);
    } catch (err) {
      process.stderr.write(`[ultimate-pi] update check failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  });
}
