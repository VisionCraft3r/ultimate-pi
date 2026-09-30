import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { analyzeBashCommand } from "./analyzer.ts";
import { promptRunOrAbort } from "./ui.ts";
import { checkBashCommand, readUserRulesLogged, userInteractiveOverride } from "../../lib/bash-policy.ts";
import { traceEvent } from "../../lib/trace.ts";
import { DenialBreaker, headlessBashOutcome } from "../../lib/denial-breaker.ts";
import {
	MAIN_DISABLED_BLOCKED,
	evaluateDisabledMainBash,
	evaluateHeadlessBash,
} from "./rules.ts";
import {
	formatJobLines,
	jobsDir,
	killRecordedJob,
	listJobs,
	resolveAgentDir,
	wrapBashForJobs,
} from "../../lib/jobs.ts";


// PI_SUBAGENT_DEPTH is 0 (or unset) in the main session and >= 1 in spawned subagent processes.
// Current pi-interactive-subagents does not set DEPTH; it does set PI_SUBAGENT_ID / AGENT.
// Behaviour branches on this: interactive prompting in the main session, headless hard-block
// for catastrophic operations in subagents (where stdin is /dev/null and no UI is available).
const _subagentDepth = Number(process.env.PI_SUBAGENT_DEPTH ?? "0");
const _isSubagent =
	(Number.isFinite(_subagentDepth) && _subagentDepth >= 1) ||
	Boolean(process.env.PI_SUBAGENT_ID || process.env.PI_SUBAGENT_AGENT);

export { analyzeBashCommand } from "./analyzer.ts";
export { MAIN_DISABLED_BLOCKED, evaluateDisabledMainBash, evaluateHeadlessBash };
// Warning shown via ctx.ui.setStatus when bash-guard is disabled. Pi joins all
// extension statuses on a single line sorted alphabetically by key, so:
//
// - Key has a leading space so it sorts before any letter-keyed extension,
//   guaranteeing the warning stays visible (truncateToWidth chops the right).
// - We deliberately do NOT pad the text to full width — that would push other
//   extensions' statuses off-screen via truncation.
// - Background is truecolor pure red (#FF0000) instead of the basic palette
//   color 41 (which terminals remap per theme, often appearing brown/orange).
//   Foreground is truecolor white for high contrast on pure red.
// - NBSPs (U+00A0) handle intra-warning spacing because the footer's
//   sanitizeStatusText collapses runs of ASCII spaces via / +/g.
const BASH_GUARD_STATUS_KEY = " bash-guard";

function recordAllowedBash(command: string): string {
	return wrapBashForJobs(command, jobsDir(resolveAgentDir()));
}

async function handleJobsCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const ledger = jobsDir(resolveAgentDir());
	const parts = args.trim().split(/\s+/).filter(Boolean);
	if (parts[0] !== "kill") {
		ctx.ui.notify(formatJobLines(listJobs(ledger)), "info");
		return;
	}

	let pid = Number(parts[1]);
	if (!Number.isInteger(pid) && ctx.hasUI) {
		const jobs = listJobs(ledger);
		if (jobs.length === 0) {
			ctx.ui.notify("No background jobs.", "info");
			return;
		}
		const choice = await ctx.ui.select(
			"Kill a background job",
			jobs.map((job) => `${job.pid}  ${job.agent}  ${job.command.slice(0, 60) || "(no command)"}`),
		);
		pid = Number(choice?.split(/\s+/)[0]);
	}
	if (!Number.isInteger(pid) || pid <= 1) {
		ctx.ui.notify("Usage: /jobs kill <pid>", "warning");
		return;
	}
	const killed = killRecordedJob(ledger, pid);
	ctx.ui.notify(
		killed ? `Killed ${killed.pid} (${killed.agent})` : `No recorded job with pid ${pid}`,
		killed ? "info" : "warning",
	);
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("jobs", {
		description: "List or kill background processes started by bash. /jobs kill <pid>",
		handler: handleJobsCommand,
	});

	if (_isSubagent) {
		// Subagent mode: hard-block catastrophic operations, no prompting.
		// Three denials in a row end the turn so the agent reports BLOCKED.
		const breaker = new DenialBreaker();
		pi.on("tool_call", async (event) => {
			if (!isToolCallEventType("bash", event)) return;
			const checked = checkBashCommand(event.input.command, {
				headless: true,
				rules: readUserRulesLogged(resolveAgentDir()),
			});
			const outcome = headlessBashOutcome(
				breaker,
				checked.decision === "forbidden"
					? { block: true, reason: checked.reason ?? "Blocked by bash-guard." }
					: undefined,
				event.input.command,
			);
			if ("block" in outcome) {
				traceEvent("bash-guard", {
					decision: outcome.terminate ? "terminate" : "forbidden",
					reason: outcome.reason,
				});
				return outcome;
			}
			event.input.command = recordAllowedBash(event.input.command);
		});
		return;
	}

	// Main session mode: interactive prompting.
	pi.registerFlag("bash-guard-auto-allow", {
		description: "If set, bash-guard will not block when no UI is available (non-interactive modes).",
		type: "boolean",
		default: false,
	});

	pi.registerFlag("bash-guard-disabled", {
		description: "Bash-guard starts fully disabled by default; this flag keeps that explicit.",
		type: "boolean",
		default: true,
	});

	// Session-local toggle. Disabled by default; the catastrophic-operation floor remains active.
	let disabled = true;

	pi.on("session_start", async (event, ctx) => {
		if (event.reason === "startup" && disabled) {
			disabled = true;
			const { theme } = ctx.ui;
			const badge = theme.bg(
				"toolErrorBg",
				theme.bold(theme.fg("error", " ⚠ BG OFF ")),
			);
			ctx.ui.setStatus(BASH_GUARD_STATUS_KEY, badge);
		}
	});

	pi.registerCommand("bash-guard", {
		description: "Toggle bash-guard between disabled (default) and interactive confirmation mode for this session.",
		handler: async (_args, ctx) => {
			disabled = !disabled;
			if (disabled) {
				const { theme } = ctx.ui;
				const badge = theme.bg(
					"toolErrorBg",
					theme.bold(theme.fg("error", " ⚠ BG OFF ")),
				);
				ctx.ui.setStatus(BASH_GUARD_STATUS_KEY, badge);
				ctx.ui.notify(
					"bash-guard DISABLED for this session. Interactive prompting is off; the catastrophic-operation floor remains in effect. Run /bash-guard again to re-enable.",
					"warning",
				);
			} else {
				ctx.ui.setStatus(BASH_GUARD_STATUS_KEY, undefined);
				ctx.ui.notify("bash-guard re-enabled.", "info");
			}
		},
	});

	// Avoid annoying retry loops: if the exact command was aborted recently, auto-block it.
	const recentlyAborted = new Map<string, number>();
	const ABORT_REMEMBER_MS = 60_000;

	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;

		const command = event.input.command;

		// Disabled mode skips interactive prompting, but the documented
		// MAIN_DISABLED_BLOCKED catastrophic floor still applies.
		if (disabled) {
			const checked = checkBashCommand(command, {
				headless: false,
				rules: readUserRulesLogged(resolveAgentDir()),
			});
			if (checked.decision === "forbidden") {
				traceEvent("bash-guard", { decision: "forbidden", reason: checked.reason ?? "" });
				return { block: true, reason: checked.reason ?? "Blocked by bash-guard." };
			}
			event.input.command = recordAllowedBash(command);
			return;
		}

		const override = userInteractiveOverride(command, readUserRulesLogged(resolveAgentDir()));
		if (override === "block") {
			return { block: true, reason: "Blocked by user bash rule." };
		}
		if (override === "allow") {
			event.input.command = recordAllowedBash(command);
			return;
		}

		const risk = analyzeBashCommand(command) ??
			(override === "prompt"
				? { severity: "medium" as const, reasons: ["user bash rule asks for confirmation"] }
				: null);
		if (!risk) {
			event.input.command = recordAllowedBash(command);
			return;
		}

		const now = Date.now();
		const lastAbort = recentlyAborted.get(command);
		if (lastAbort && now - lastAbort < ABORT_REMEMBER_MS) {
			return {
				block: true,
				reason:
					"Blocked by bash-guard: command was already aborted recently. Ask the user for a safer alternative; do not retry the same command.",
			};
		}

		if (!ctx.hasUI && pi.getFlag("--bash-guard-auto-allow")) {
			// Non-interactive mode: allow when explicitly requested.
			event.input.command = recordAllowedBash(command);
			return;
		}

		const choice = await promptRunOrAbort(ctx, command, risk);
		if (choice === "run") {
			event.input.command = recordAllowedBash(command);
			return;
		}

		recentlyAborted.set(command, now);
		return {
			block: true,
			reason:
				"Blocked by user via bash-guard (potentially destructive command). Ask the user for confirmation or propose a non-destructive alternative.",
		};
	});
}
