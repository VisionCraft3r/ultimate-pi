import assert from "node:assert/strict";
import { test } from "node:test";
import {
	SCOUT_CEILING_REASON,
	SCOUT_TOOL_ROUNDS,
	isAssistantToolRound,
	scoutToolCallDecision,
} from "../extensions/scout-budget.ts";

test("a tool round is an assistant message that contains a tool call", () => {
	assert.equal(
		isAssistantToolRound({
			role: "assistant",
			content: [{ type: "text", text: "looking" }, { type: "toolCall", name: "grep" }],
		}),
		true,
	);
	assert.equal(isAssistantToolRound({ role: "assistant", content: [{ type: "text", text: "map" }] }), false);
	assert.equal(isAssistantToolRound({ role: "user", content: [{ type: "toolCall" }] }), false);
});

test("round 20 still runs and round 21 is blocked", () => {
	assert.equal(scoutToolCallDecision(SCOUT_TOOL_ROUNDS), undefined);
	const blocked = scoutToolCallDecision(SCOUT_TOOL_ROUNDS + 1);
	assert.equal(blocked?.block, true);
	assert.equal(blocked?.terminate, true);
	assert.equal(blocked?.reason, SCOUT_CEILING_REASON);
});
