import assert from "node:assert/strict";
import { test } from "node:test";
import { ifActiveSession, isReplacedSessionError } from "../lib/stale-session.ts";

const STALE = new Error(
	"This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx.",
);

test("a replaced session is recognized from Pi's stale-context error", () => {
	assert.equal(isReplacedSessionError(STALE), true);
	assert.equal(isReplacedSessionError(new Error("session file missing")), false);
});

test("reading a replaced session returns the fallback", () => {
	const ctx = {
		get sessionManager(): { getEntries: () => unknown[] } {
			throw STALE;
		},
	};
	assert.deepEqual(
		ifActiveSession(() => ctx.sessionManager.getEntries(), []),
		[],
	);
});

test("a live session read is returned unchanged", () => {
	assert.equal(ifActiveSession(() => "live", "fallback"), "live");
});

test("errors other than session replacement still throw", () => {
	assert.throws(
		() =>
			ifActiveSession(() => {
				throw new Error("disk full");
			}, "fallback"),
		/disk full/,
	);
});
