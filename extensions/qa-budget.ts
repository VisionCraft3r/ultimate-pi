/**
 * Caps qa_tester at 20 tool rounds. Parent and other roles load this file only
 * because Pi auto-loads extensions/*.ts; they no-op unless this process is qa_tester.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	installHardRoundBudget,
	isAssistantToolRound,
	roundCeilingDecision,
} from "../lib/round-budget.ts";

export const QA_TOOL_ROUNDS = 20;

export const QA_CEILING_REASON =
	"QA tool-round ceiling (20) reached. Return pass or fail and the failing step now. Do not call more tools.";

export { isAssistantToolRound };

export function qaToolCallDecision(
	rounds: number,
): { block: true; terminate: true; reason: string } | undefined {
	return roundCeilingDecision(rounds, QA_TOOL_ROUNDS, QA_CEILING_REASON);
}

export default function (pi: ExtensionAPI) {
	if (process.env.PI_SUBAGENT_AGENT !== "qa_tester") return;
	installHardRoundBudget(pi, {
		ceiling: QA_TOOL_ROUNDS,
		reason: QA_CEILING_REASON,
		customType: "qa-budget",
	});
}
