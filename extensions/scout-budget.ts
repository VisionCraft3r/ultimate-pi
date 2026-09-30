/**
 * Caps scout at 20 tool rounds. Parent and other roles load this file only
 * because Pi auto-loads extensions/*.ts; they no-op unless this process is scout.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	installHardRoundBudget,
	isAssistantToolRound,
	roundCeilingDecision,
} from "../lib/round-budget.ts";

export const SCOUT_TOOL_ROUNDS = 20;

export const SCOUT_CEILING_REASON =
	"Scout tool-round ceiling (20) reached. Return the file and line map now. Do not call more tools.";

export { isAssistantToolRound };

export function scoutToolCallDecision(
	rounds: number,
): { block: true; terminate: true; reason: string } | undefined {
	return roundCeilingDecision(rounds, SCOUT_TOOL_ROUNDS, SCOUT_CEILING_REASON);
}

export default function (pi: ExtensionAPI) {
	if (process.env.PI_SUBAGENT_AGENT !== "scout") return;
	installHardRoundBudget(pi, {
		ceiling: SCOUT_TOOL_ROUNDS,
		reason: SCOUT_CEILING_REASON,
		customType: "scout-budget",
	});
}
