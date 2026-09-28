/**
 * Caps scout at 20 tool rounds. Parent and other roles load this file only
 * because Pi auto-loads extensions/*.ts; they no-op unless this process is scout.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const SCOUT_TOOL_ROUNDS = 20;

export const SCOUT_CEILING_REASON =
	"Scout tool-round ceiling (20) reached. Return the file and line map now. Do not call more tools.";

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

export function scoutToolCallDecision(
	rounds: number,
): { block: true; terminate: true; reason: string } | undefined {
	if (rounds > SCOUT_TOOL_ROUNDS) {
		return { block: true, terminate: true, reason: SCOUT_CEILING_REASON };
	}
	return undefined;
}

export default function (pi: ExtensionAPI) {
	if (process.env.PI_SUBAGENT_AGENT !== "scout") return;

	let rounds = 0;
	let mapRequested = false;

	pi.on("message_end", (event) => {
		if (isAssistantToolRound(event.message as MaybeMessage)) rounds += 1;
	});

	pi.on("tool_call", () => scoutToolCallDecision(rounds));

	pi.on("agent_before_settle", (event) => {
		if (mapRequested || rounds < SCOUT_TOOL_ROUNDS) return;
		if (event.outcome !== "completed" || !event.context.canContinue) return;
		mapRequested = true;
		return {
			continue: true,
			entries: [
				{
					type: "custom_message" as const,
					customType: "scout-budget",
					content: SCOUT_CEILING_REASON,
					display: true,
				},
			],
		};
	});
}
