/**
 * Shared tool-round ceiling. Scout and qa_tester hard-stop. Worker may opt
 * into a wrap-up steer that does not block tools.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { traceEvent } from "./trace.ts";

export type MaybeMessage = { role?: string; content?: unknown };

export type RoundBlock = { block: true; terminate: true; reason: string };

export const WORKER_NUDGE_ENV = "ULTIMATE_PI_WORKER_ROUND_NUDGE";

export const WORKER_NUDGE_REASON =
	"Worker tool-round nudge. Wrap up this turn: report Status, Changes Made, Verification, and what is left. Do not open a new file.";

export function isAssistantToolRound(message: MaybeMessage): boolean {
	if (message.role !== "assistant" || !Array.isArray(message.content)) return false;
	return message.content.some(
		(block) =>
			!!block &&
			typeof block === "object" &&
			(block as { type?: string }).type === "toolCall",
	);
}

/** Round `ceiling` still runs. The next round is blocked. */
export function roundCeilingDecision(rounds: number, ceiling: number, reason: string): RoundBlock | undefined {
	if (rounds > ceiling) return { block: true, terminate: true, reason };
	return undefined;
}

type SettleEvent = {
	outcome?: string;
	context?: { canContinue?: boolean };
};

function settleSteer(customType: string, content: string) {
	return {
		continue: true as const,
		entries: [
			{
				type: "custom_message" as const,
				customType,
				content,
				display: true,
			},
		],
	};
}

export function installHardRoundBudget(
	pi: ExtensionAPI,
	options: { ceiling: number; reason: string; customType: string },
): void {
	let rounds = 0;
	let requested = false;

	pi.on("message_end", (event) => {
		if (isAssistantToolRound(event.message as MaybeMessage)) rounds += 1;
	});

	pi.on("tool_call", () => {
		const decision = roundCeilingDecision(rounds, options.ceiling, options.reason);
		if (decision) traceEvent("round-budget", { customType: options.customType, ceiling: options.ceiling, mode: "hard" });
		return decision;
	});

	pi.on("agent_before_settle", (event) => {
		const settle = event as SettleEvent;
		if (requested || rounds < options.ceiling) return;
		if (settle.outcome !== "completed" || !settle.context?.canContinue) return;
		requested = true;
		return settleSteer(options.customType, options.reason);
	});
}

/**
 * Counts tool rounds and, once, asks the agent to wrap up. Does not block
 * further tool calls. Used for the opt-in worker nudge.
 */
export function installSoftRoundNudge(
	pi: ExtensionAPI,
	options: { ceiling: number; reason: string; customType: string },
): void {
	let rounds = 0;
	let requested = false;

	pi.on("message_end", (event) => {
		if (isAssistantToolRound(event.message as MaybeMessage)) rounds += 1;
	});

	pi.on("agent_before_settle", (event) => {
		const settle = event as SettleEvent;
		if (requested || rounds < options.ceiling) return;
		if (settle.outcome !== "completed" || !settle.context?.canContinue) return;
		requested = true;
		traceEvent("round-budget", { customType: options.customType, ceiling: options.ceiling, mode: "soft" });
		return settleSteer(options.customType, options.reason);
	});
}

/** Positive integer from ULTIMATE_PI_WORKER_ROUND_NUDGE, or unset. */
export function workerRoundNudgeLimit(env: NodeJS.ProcessEnv = process.env): number | undefined {
	const raw = env[WORKER_NUDGE_ENV]?.trim();
	if (!raw) return undefined;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 1) return undefined;
	return Math.floor(parsed);
}
