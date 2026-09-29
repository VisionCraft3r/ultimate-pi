import assert from "node:assert/strict";
import { test } from "node:test";
import { QA_CEILING_REASON, QA_TOOL_ROUNDS, isAssistantToolRound, qaToolCallDecision } from "../extensions/qa-budget.ts";

test("a QA tool round is an assistant message that contains a tool call", () => {
	assert.equal(
		isAssistantToolRound({
			role: "assistant",
			content: [{ type: "text", text: "checking" }, { type: "toolCall", name: "browser_click" }],
		}),
		true,
	);
	assert.equal(isAssistantToolRound({ role: "assistant", content: [{ type: "text", text: "pass" }] }), false);
	assert.equal(isAssistantToolRound({ role: "user", content: [{ type: "toolCall" }] }), false);
});

test("QA round 20 still runs and round 21 is blocked", () => {
	assert.equal(qaToolCallDecision(QA_TOOL_ROUNDS), undefined);
	const blocked = qaToolCallDecision(QA_TOOL_ROUNDS + 1);
	assert.equal(blocked?.block, true);
	assert.equal(blocked?.terminate, true);
	assert.equal(blocked?.reason, QA_CEILING_REASON);
});
