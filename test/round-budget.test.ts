import assert from "node:assert/strict";
import { test } from "node:test";
import { workerRoundNudgeLimit } from "../lib/round-budget.ts";

test("worker round nudge stays off unless the env is a positive integer", () => {
	assert.equal(workerRoundNudgeLimit({}), undefined);
	assert.equal(workerRoundNudgeLimit({ ULTIMATE_PI_WORKER_ROUND_NUDGE: "0" }), undefined);
	assert.equal(workerRoundNudgeLimit({ ULTIMATE_PI_WORKER_ROUND_NUDGE: "no" }), undefined);
	assert.equal(workerRoundNudgeLimit({ ULTIMATE_PI_WORKER_ROUND_NUDGE: "12" }), 12);
});
