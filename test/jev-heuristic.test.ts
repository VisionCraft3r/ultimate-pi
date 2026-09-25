import assert from "node:assert/strict";
import { test } from "node:test";
import {
	classifyHeuristic,
	HEURISTIC_MAX_CONFIDENCE,
	HEURISTIC_UNCONFIGURED_PREFIX,
	formatFailSoftTier0,
	formatHeuristicTriage,
} from "../lib/jev-heuristic.ts";

test("continuation crumbs classify as tier_0 at the confidence cap", () => {
	for (const prompt of ["continue", "ship this", "push to production"]) {
		const result = classifyHeuristic(prompt);
		assert.equal(result.tier, "tier_0", prompt);
		assert.equal(result.confidence, HEURISTIC_MAX_CONFIDENCE, prompt);
	}
});

test("browser/e2e click-through prompts classify as tier_4_qa", () => {
	for (const prompt of [
		"click through the checkout flow in the browser",
		"run e2e tests against the simulator",
		"visually verify the login screen",
	]) {
		const result = classifyHeuristic(prompt);
		assert.equal(result.tier, "tier_4_qa", prompt);
		assert.equal(result.confidence, HEURISTIC_MAX_CONFIDENCE, prompt);
	}
});

test("plan/architecture prompts classify as tier_3", () => {
	for (const prompt of [
		"write a plan for the billing rewrite",
		"design the architecture of the auth subsystem",
		"spec out a new service for retries",
	]) {
		const result = classifyHeuristic(prompt);
		assert.equal(result.tier, "tier_3", prompt);
		assert.equal(result.confidence, HEURISTIC_MAX_CONFIDENCE, prompt);
	}
});

test("bug reports without a named file classify as tier_2", () => {
	for (const prompt of [
		"the login button is broken",
		"check why the login button is grey, it doesn't work",
		"when i click submit nothing happens",
	]) {
		const result = classifyHeuristic(prompt);
		assert.equal(result.tier, "tier_2", prompt);
		assert.equal(result.confidence, HEURISTIC_MAX_CONFIDENCE, prompt);
	}
});

test("named files, function calls, and typos classify as tier_1", () => {
	for (const prompt of [
		"refactor the payment retry logic in retry.ts",
		"fix handleRetry( across three files",
		"fix the typo in the checkout copy",
	]) {
		const result = classifyHeuristic(prompt);
		assert.equal(result.tier, "tier_1", prompt);
		assert.equal(result.confidence, HEURISTIC_MAX_CONFIDENCE, prompt);
	}
});

test("questions without files classify as tier_0", () => {
	for (const prompt of [
		"what is the routing table?",
		"how do I configure retries",
		"why is the login button grey",
	]) {
		const result = classifyHeuristic(prompt);
		assert.equal(result.tier, "tier_0", prompt);
		assert.equal(result.confidence, HEURISTIC_MAX_CONFIDENCE, prompt);
	}
});

test("unmatched prompts fall back to tier_1 with confidence 45", () => {
	const result = classifyHeuristic("refactor the payment retry logic across 3 files");
	assert.equal(result.tier, "tier_1");
	assert.equal(result.confidence, 45);
});

test("heuristic confidence never exceeds the 60 cap", () => {
	const prompts = [
		"continue",
		"click through the checkout flow in the browser",
		"write a plan for the billing rewrite",
		"the login button is broken",
		"refactor the payment retry logic in retry.ts",
		"what is the routing table?",
		"refactor the payment retry logic across 3 files",
	];
	for (const prompt of prompts) {
		const { confidence } = classifyHeuristic(prompt);
		assert.ok(confidence <= HEURISTIC_MAX_CONFIDENCE, `${prompt} -> ${confidence}`);
		assert.ok(confidence <= 60, `${prompt} -> ${confidence}`);
	}
});

test("formatHeuristicTriage prefixes a visible heuristic-fallback warning", () => {
	const text = formatHeuristicTriage("continue");
	assert.equal(text.startsWith(HEURISTIC_UNCONFIGURED_PREFIX), true);
	assert.match(text, /Triage Result: tier_0/);
});

test("formatFailSoftTier0 stays tier_0 and never escalates", () => {
	const text = formatFailSoftTier0("API returned HTTP 401");
	assert.match(text, /Fail-soft: tier_0/);
	assert.match(text, /Triage Result: tier_0/);
	assert.doesNotMatch(text, /tier_1|tier_2|tier_3|tier_4/);
});

