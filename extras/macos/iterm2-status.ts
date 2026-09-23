/**
 * Optional macOS extra: push Pi session status into iTerm2 via an external
 * `cc-status` binary (or any compatible stdin-JSON helper).
 *
 * Path: `ULTIMATE_PI_ITERM_STATUS_BIN`, else `~/.config/iterm2/cc-status`.
 * If the binary is missing, or this is not an iTerm session (`TERM_SESSION_ID`
 * unset), the extension is a silent no-op — never an error.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function resolveStatusBin(): string | undefined {
	const fromEnv = process.env.ULTIMATE_PI_ITERM_STATUS_BIN?.trim();
	const candidate = fromEnv || join(homedir(), ".config", "iterm2", "cc-status");
	return existsSync(candidate) ? candidate : undefined;
}

function lastAssistantText(ctx: ExtensionContext): string {
	for (const entry of [...ctx.sessionManager.getEntries()].reverse()) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const content = entry.message.content;
		if (!Array.isArray(content)) return "";
		return content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("\n");
	}
	return "";
}

function updateStatus(event: string, ctx: ExtensionContext, extra: Record<string, unknown> = {}): Promise<void> {
	// The helper identifies the iTerm session through TERM_SESSION_ID. Outside
	// iTerm (including print/RPC runs) this intentionally does nothing.
	if (!process.env.TERM_SESSION_ID) return Promise.resolve();

	const bin = resolveStatusBin();
	if (!bin) return Promise.resolve();

	const payload = JSON.stringify({
		session_id: ctx.sessionManager.getSessionId(),
		transcript_path: ctx.sessionManager.getSessionFile(),
		cwd: ctx.cwd,
		hook_event_name: event,
		...extra,
	});

	return new Promise((resolve) => {
		const child = execFile(bin, [], { timeout: 3_000 }, () => resolve());
		child.stdin?.end(payload);
	});
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		await updateStatus("SessionStart", ctx);
	});

	pi.on("agent_start", async (_event, ctx) => {
		await updateStatus("UserPromptSubmit", ctx);
	});

	pi.on("tool_execution_start", async (_event, ctx) => {
		await updateStatus("PreToolUse", ctx);
	});

	pi.on("ui_prompt_start", async (event, ctx) => {
		await updateStatus("PermissionRequest", ctx, {
			tool_name: event.kind === "input" ? "AskUserQuestion" : event.kind,
			tool_input: { questions: [{ question: event.title ?? "Waiting for your response" }] },
		});
	});

	pi.on("ui_prompt_end", async (_event, ctx) => {
		await updateStatus(ctx.isIdle() ? "Stop" : "UserPromptSubmit", ctx, {
			last_assistant_message: lastAssistantText(ctx),
		});
	});

	pi.on("agent_settled", async (_event, ctx) => {
		await updateStatus("Stop", ctx, { last_assistant_message: lastAssistantText(ctx) });
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		await updateStatus("SessionEnd", ctx);
	});
}
