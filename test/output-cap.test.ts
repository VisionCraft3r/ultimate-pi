import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { capText, currentRoleCanRead, presentCapped } from "../lib/output-cap.ts";

test("short text is unchanged", () => {
	assert.equal(capText("hello").text, "hello");
	assert.equal(capText("hello").truncated, false);
});

test("long text keeps a head, a tail, and an omitted count", () => {
	const text = `${"a".repeat(80)}MIDDLE${"b".repeat(80)}`;
	const capped = capText(text, 80);
	assert.equal(capped.truncated, true);
	assert.match(capped.text, /truncated \d+ characters/);
	assert.equal(capped.text.startsWith("aaa"), true);
	assert.equal(capped.text.endsWith("bbb"), true);
});

test("spill is for roles that can read; qa and researcher only see the marker", () => {
	assert.equal(currentRoleCanRead(""), true);
	assert.equal(currentRoleCanRead("worker"), true);
	assert.equal(currentRoleCanRead("researcher"), false);
	assert.equal(currentRoleCanRead("qa_tester"), false);

	const text = "x".repeat(200);
	const spilled = presentCapped(text, { maxChars: 80, spill: true });
	assert.match(spilled, /Full text: /);
	const path = spilled.match(/Full text: (\S+)/)?.[1];
	assert.ok(path);
	assert.equal(readFileSync(path!, "utf8"), text);

	const quiet = presentCapped(text, { maxChars: 80, spill: false });
	assert.doesNotMatch(quiet, /Full text:/);
	assert.match(quiet, /truncated/);
});
