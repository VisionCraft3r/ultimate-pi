import assert from "node:assert/strict";
import { test } from "node:test";
import {
	isContinuationCrumb,
	normalizePrompt,
} from "../lib/continuation-crumbs.ts";

test("normalizePrompt lowercases, trims, and collapses whitespace", () => {
	assert.equal(normalizePrompt("  Keep   GOING  "), "keep going");
	assert.equal(normalizePrompt("PUSH\tto\nProduction"), "push to production");
});

test("normalizePrompt strips trailing punctuation and a leading please", () => {
	assert.equal(normalizePrompt("Continue!!!"), "continue");
	assert.equal(normalizePrompt("please ship this."), "ship this");
	assert.equal(normalizePrompt("Please  try again!?"), "try again");
});

test("exact continue phrases are continuation crumbs", () => {
	for (const prompt of ["proceed", "keep going", "try again", "go ahead", "continue"]) {
		assert.equal(isContinuationCrumb(prompt), true, prompt);
	}
	assert.equal(isContinuationCrumb("  Please CONTINUE.  "), true);
});

test("listed ship/follow-up phrases are continuation crumbs", () => {
	for (const prompt of [
		"ship this",
		"shipped",
		"push to production",
		"push to prod",
		"update the app",
		"document push and commit",
	]) {
		assert.equal(isContinuationCrumb(prompt), true, prompt);
	}
});

test("short prefixes of listed crumbs still count as continuation", () => {
	assert.equal(isContinuationCrumb("push to production now"), true);
	assert.equal(isContinuationCrumb("ship this please"), true);
});

test("short ship-only prompts with no leftover task tokens are crumbs", () => {
	for (const prompt of ["push to prod", "please deploy this now", "commit and send"]) {
		assert.equal(isContinuationCrumb(prompt), true, prompt);
	}
});

test("implement the plan plus a ship signal is a continuation crumb", () => {
	assert.equal(isContinuationCrumb("implement the plan and push to production"), true);
	assert.equal(isContinuationCrumb("implement the plan, then ship"), true);
});

test("implement the plan without a ship signal is not a crumb", () => {
	assert.equal(isContinuationCrumb("implement the plan for the billing rewrite"), false);
});

test("regular task prompts are not continuation crumbs", () => {
	for (const prompt of [
		"check why the login button is grey",
		"refactor the payment retry logic across 3 files",
		"what is the routing table?",
		"write a plan for the billing rewrite",
	]) {
		assert.equal(isContinuationCrumb(prompt), false, prompt);
	}
});

test("ship phrasing with leftover task tokens is not a crumb", () => {
	assert.equal(
		isContinuationCrumb("rewrite the auth module then push to production"),
		false,
	);
	assert.equal(isContinuationCrumb("deploy the new retry worker"), false);
});
