/**
 * Context bar and git dirty line above the editor.
 *
 * The parent loads this by extension discovery. Children start with
 * --no-extensions, so `session_chrome` is on every profile's tools list and
 * registerToolExtension adds `-e` this file. The tool is hidden: the name
 * only exists so the child process loads the widget.
 */

import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	formatContextBar,
	formatGitLine,
	readGitSnapshot,
	type ContextLevel,
	type GitSnapshot,
} from "../lib/session-chrome.ts";
import { isReplacedSessionError } from "../lib/stale-session.ts";

const THIS_FILE = fileURLToPath(import.meta.url);
const WIDGET_ID = "session-chrome";
const MUTATING = new Set(["bash", "edit", "write"]);

const LEVEL_COLOR: Record<ContextLevel, "success" | "warning" | "error" | "muted"> = {
	ok: "success",
	warning: "warning",
	error: "error",
	unknown: "muted",
};

function registerForSubagents(name: string, extensionPath: string): void {
	const register = (globalThis as { __pi_interactive_subagents?: { registerToolExtension?: (name: string, path: string) => void } })
		.__pi_interactive_subagents?.registerToolExtension;
	if (typeof register !== "function") return;
	try {
		register(name, extensionPath);
	} catch {
		// already bound to this path, or another extension claimed the name
	}
}

export default function sessionChrome(pi: ExtensionAPI) {
	registerForSubagents("session_chrome", THIS_FILE);

	let hidden = false;
	let git: GitSnapshot = { repo: false };
	let refresh = 0;

	pi.registerTool({
		name: "session_chrome",
		label: "Session chrome",
		description: "Hidden. Listed so this pane loads its own context bar. Not for the model to call.",
		exposure: "hidden",
		parameters: Type.Object({}),
		async execute() {
			return {
				content: [{ type: "text" as const, text: "session_chrome is a display widget, not a tool." }],
				details: {},
			};
		},
	});

	function paint(ctx: ExtensionContext) {
		try {
			paintLive(ctx);
		} catch (error) {
			if (isReplacedSessionError(error)) return;
			throw error;
		}
	}

	function paintLive(ctx: ExtensionContext) {
		if (!ctx.hasUI || ctx.mode !== "tui") return;
		if (hidden) {
			ctx.ui.setWidget(WIDGET_ID, undefined);
			return;
		}
		const theme = ctx.ui.theme;
		const lines: string[] = [];
		const usage = ctx.getContextUsage();
		if (usage) {
			const bar = formatContextBar(usage);
			lines.push(`ctx  ${theme.fg(LEVEL_COLOR[bar.level], bar.bar)}  ${bar.percentLabel}   ${bar.tokensLabel}`);
		}
		if (git.repo) {
			lines.push(theme.fg("dim", `git  ${formatGitLine(git.branch, git)}`));
		}
		ctx.ui.setWidget(WIDGET_ID, lines.length > 0 ? lines : undefined);
	}

	function refreshGit(ctx: ExtensionContext): Promise<void> {
		let cwd: string;
		try {
			cwd = ctx.cwd;
		} catch (error) {
			if (isReplacedSessionError(error)) return Promise.resolve();
			throw error;
		}
		const token = ++refresh;
		return readGitSnapshot(cwd)
			.then((next) => {
				if (token !== refresh) return;
				git = next;
				paint(ctx);
			})
			.catch(() => {
				// A failed status read leaves the previous line in place.
			});
	}

	pi.on("session_start", (_event, ctx) => {
		registerForSubagents("session_chrome", THIS_FILE);
		// Pi awaits session_start before the prompt. Do not return this promise.
		void refreshGit(ctx);
	});

	pi.on("agent_end", (_event, ctx) => {
		void refreshGit(ctx);
	});

	pi.on("tool_result", (event, ctx) => {
		if (!MUTATING.has(event.toolName)) return;
		void refreshGit(ctx);
	});

	pi.registerCommand("chrome", {
		description: "Hide or show the context bar and git line. /chrome refresh updates git.",
		handler: async (args, ctx) => {
			if (args.trim() === "refresh") {
				await refreshGit(ctx);
				ctx.ui.notify("Session chrome refreshed.", "info");
				return;
			}
			hidden = !hidden;
			if (hidden) paint(ctx);
			else await refreshGit(ctx);
			ctx.ui.notify(hidden ? "Session chrome hidden." : "Session chrome shown.", "info");
		},
	});
}
