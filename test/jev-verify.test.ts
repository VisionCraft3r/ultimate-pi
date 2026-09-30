import assert from "node:assert/strict";
import { test } from "node:test";
import { formatHeuristicTriage } from "../lib/jev-heuristic.ts";
import { classifyVerification, verificationFromChoice } from "../lib/jev-verify.ts";

test("ordinary fixes verify with the worker's tests", () => {
	assert.equal(classifyVerification("fix the typo in src/auth.ts", "tier_1"), "tests");
	assert.match(formatHeuristicTriage("fix the typo in src/auth.ts"), /Verification: tests/);
});

test("a click bug verifies in the browser, not with a reviewer", () => {
	assert.equal(classifyVerification("when i click submit nothing happens", "tier_2"), "browser");
	assert.equal(classifyVerification("the login button is broken", "tier_2"), "browser");
});

test("core logic verifies with a scout", () => {
	assert.equal(classifyVerification("make sure the logic of the discount math", "tier_1"), "scout");
	assert.equal(classifyVerification("verify the invariant in the scheduler", "tier_2"), "scout");
});

test("payment and data-loss risk verifies with a reviewer", () => {
	assert.equal(classifyVerification("fix the payment retry so we cannot double charge", "tier_1"), "reviewer");
	assert.equal(classifyVerification("the billing migration must not drop invoices", "tier_3"), "reviewer");
});

test("audit and QA tiers keep their own check", () => {
	assert.equal(classifyVerification("project audit", "tier_5_review"), "reviewer");
	assert.equal(classifyVerification("click through checkout in the browser", "tier_4_qa"), "browser");
	assert.equal(classifyVerification("what is the routing table?", "tier_0"), "tests");
});

test("a weak live verification choice cannot invent a reviewer", () => {
	assert.equal(verificationFromChoice("tier_1", "reviewer", 0.4), "tests");
	assert.equal(verificationFromChoice("tier_1", "reviewer", undefined), "tests");
	assert.equal(verificationFromChoice("tier_1", "scout", 0.8), "scout");
	assert.equal(verificationFromChoice("tier_2", "browser", 0.9), "browser");
	assert.equal(verificationFromChoice("tier_5_review", "tests", 0.99), "reviewer");
	assert.equal(verificationFromChoice("tier_0", "reviewer", 0.99), "tests");
});
