/**
 * Caps qa_tester at 20 tool rounds. Parent and other roles load this file only
 * because Pi auto-loads extensions/*.ts; they no-op unless this process is qa_tester.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const QA_TOOL_ROUNDS = 20;

export const QA_CEILING_REASON =
	"QA tool-round ceiling (20) reached. Return pass or fail and the failing step now. Do not call more tools.";

type MaybeMessage = { role?: string; content?: unknown };

export function isAssistantToolRound(message: MaybeMessage): boolean {
	if (message.role !== "assistant" || !Array.isArray(message.content)) return false;
	return message.content.some(
		(block) =>
			!!block &&
			typeof block === "object" &&
			(block as { type?: string }).type === "toolCall",
	);
}

export function qaToolCallDecision(
	rounds: number,
): { block: true; terminate: true; reason: string } | undefined {
	if (rounds > QA_TOOL_ROUNDS) {
		return { block: true, terminate: true, reason: QA_CEILING_REASON };
	}
	return undefined;
}

export default function (pi: ExtensionAPI) {
	if (process.env.PI_SUBAGENT_AGENT !== "qa_tester") return;

	let rounds = 0;
	let reportRequested = false;

	pi.on("message_end", (event) => {
		if (isAssistantToolRound(event.message as MaybeMessage)) rounds += 1;
	});

	pi.on("tool_call", () => qaToolCallDecision(rounds));

	pi.on("agent_before_settle", (event) => {
		if (reportRequested || rounds < QA_TOOL_ROUNDS) return;
		if (event.outcome !== "completed" || !event.context.canContinue) return;
		reportRequested = true;
		return {
			continue: true,
			entries: [
				{
					type: "custom_message" as const,
					customType: "qa-budget",
					content: QA_CEILING_REASON,
					display: true,
				},
			],
		};
	});
}
