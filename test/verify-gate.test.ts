import assert from "node:assert/strict";
import { test } from "node:test";
import {
	VERIFY_GATE_REASON,
	lastAssistantText,
	missingDoneVerification,
	verifyGateAction,
} from "../lib/verify-gate.ts";

const doneWithoutCommand = `## Status
DONE

## Changes Made
- \`src/a.ts\` — renamed a helper

## Verification
- tests should pass

## Risks
None
`;

const doneWithCommand = `## Status
DONE

## Verification
- \`npm test\` — pass
`;

const blocked = `## Status
BLOCKED

## Verification
waiting on a product choice
`;

test("DONE without a backticked command is missing verification", () => {
	assert.equal(missingDoneVerification(doneWithoutCommand), true);
	assert.equal(missingDoneVerification(doneWithCommand), false);
	assert.equal(missingDoneVerification(blocked), false);
	assert.equal(missingDoneVerification("no status heading"), false);
});

test("the gate nudges once", () => {
	const first = verifyGateAction(doneWithoutCommand, false);
	assert.equal(first?.nudge, true);
	assert.equal(first?.reason, VERIFY_GATE_REASON);
	assert.equal(verifyGateAction(doneWithoutCommand, true), undefined);
	assert.equal(verifyGateAction(doneWithCommand, false), undefined);
});

test("last assistant text comes from the session", () => {
	const text = lastAssistantText({
		sessionManager: {
			getEntries: () => [
				{ type: "message", message: { role: "user", content: "go" } },
				{ type: "message", message: { role: "assistant", content: [{ type: "text", text: doneWithCommand }] } },
			],
		},
	});
	assert.equal(missingDoneVerification(text), false);
});
