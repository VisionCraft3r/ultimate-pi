import assert from "node:assert/strict";
import { test } from "node:test";
import { DENIAL_LIMIT, DenialBreaker, headlessBashOutcome } from "../lib/denial-breaker.ts";

const blocked = { block: true as const, reason: "Blocked by bash-guard: git push" };

test("three consecutive denials terminate and an allowed command resets the count", () => {
	const breaker = new DenialBreaker();
	assert.equal(DENIAL_LIMIT, 3);

	const first = headlessBashOutcome(breaker, blocked, "git push");
	assert.equal("terminate" in first && first.terminate, false);
	assert.equal("block" in first && first.block, true);

	const second = headlessBashOutcome(breaker, blocked, "git push origin");
	assert.equal("terminate" in second && second.terminate, false);

	headlessBashOutcome(breaker, undefined, "git status");

	const afterReset = headlessBashOutcome(breaker, blocked, "git push");
	assert.equal("terminate" in afterReset && afterReset.terminate, false);

	headlessBashOutcome(breaker, blocked, "git push");
	const third = headlessBashOutcome(breaker, blocked, "sudo true");
	assert.equal("block" in third && third.block, true);
	assert.equal("terminate" in third && third.terminate, true);
	if ("reason" in third) {
		assert.match(third.reason, /Status BLOCKED/);
		assert.match(third.reason, /sudo true/);
	}
});
