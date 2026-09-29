/**
 * Paperclip starts pi with --print, which exits when the turn settles.
 * Hold that settle while a spawned subagent is still running so its pane
 * stays up and its question or result can steer the same run.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { waitForSubagentWake } from "../lib/paperclip-subagent-hold.ts";

export default function paperclipSubagentHold(pi: ExtensionAPI) {
  pi.on("agent_before_settle", async () => {
    await waitForSubagentWake();
  });
}
