import assert from "node:assert/strict";
import { test } from "node:test";
import {
	DEFAULT_JEV_TIMEOUT_MS,
	jevFailureReason,
	jevRequestSignal,
	resolveJevTimeoutMs,
} from "../lib/jev-config.ts";
import { formatHeuristicTriage } from "../lib/jev-heuristic.ts";

test("JEV timeout defaults to 8s and honors a positive override", () => {
	const previous = process.env.ULTIMATE_PI_JEV_TIMEOUT_MS;
	try {
		delete process.env.ULTIMATE_PI_JEV_TIMEOUT_MS;
		assert.equal(resolveJevTimeoutMs(), DEFAULT_JEV_TIMEOUT_MS);
		process.env.ULTIMATE_PI_JEV_TIMEOUT_MS = "1500";
		assert.equal(resolveJevTimeoutMs(), 1500);
		process.env.ULTIMATE_PI_JEV_TIMEOUT_MS = "0";
		assert.equal(resolveJevTimeoutMs(), DEFAULT_JEV_TIMEOUT_MS);
	} finally {
		if (previous === undefined) delete process.env.ULTIMATE_PI_JEV_TIMEOUT_MS;
		else process.env.ULTIMATE_PI_JEV_TIMEOUT_MS = previous;
	}
});

test("a timed-out JEV signal becomes the visible timeout warning", async () => {
	const signal = jevRequestSignal(undefined, 20);
	await new Promise<void>((resolve) => {
		if (signal.aborted) resolve();
		else signal.addEventListener("abort", () => resolve(), { once: true });
	});
	assert.equal(signal.aborted, true);
	assert.equal(jevFailureReason(signal.reason), "timeout");
	const text = formatHeuristicTriage("continue", { unavailableReason: jevFailureReason(signal.reason) });
	assert.match(text, /JEV unavailable \(timeout\)/);
	assert.match(text, /Triage Result: tier_0/);
});

test("an already-cancelled tool signal aborts the JEV request immediately", () => {
	const tool = new AbortController();
	tool.abort();
	const signal = jevRequestSignal(tool.signal, 30_000);
	assert.equal(signal.aborted, true);
	assert.equal(jevFailureReason(signal.reason), "cancelled");
});

test("other fetch failures stay network errors", () => {
	assert.equal(jevFailureReason(new Error("API returned HTTP 500")), "network error: API returned HTTP 500");
});
