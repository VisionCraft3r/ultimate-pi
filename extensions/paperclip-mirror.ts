/**
 * When a Paperclip run spawns a tmux subagent, record it as a child task.
 * The child is an unassigned board card. The pane is the run, so the role agent is not woken.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  closeFromMessage,
  closeMirrorIssue,
  createMirrorIssue,
  createMirrorSession,
  launchFromToolResult,
  mirrorEnv,
} from "../lib/paperclip-mirror.ts";

export default function paperclipMirror(pi: ExtensionAPI) {
  const session = createMirrorSession();

  pi.on("tool_result", async (event) => {
    const env = mirrorEnv();
    const launch = launchFromToolResult(event);
    if (!env || !launch) return;
    try {
      const issueId = await createMirrorIssue({ env, launch });
      if (issueId) session.remember(launch.name, issueId);
    } catch {
      // The pane is already running. A missed board card must not fail the turn.
    }
  });

  pi.on("message_end", async (event) => {
    const env = mirrorEnv();
    const close = closeFromMessage(event.message);
    if (!env || !close) return;
    const issueId = session.issueId(close.name);
    if (!issueId) return;
    try {
      await closeMirrorIssue({ env, issueId, close });
    } catch {
      // The result is already in the orchestrator session.
    }
  });
}
