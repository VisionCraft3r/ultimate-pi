import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { noteIfReviewVerdict } from "../lib/review-verdict.ts";
import { resetTraceForTests, traceEvent } from "../lib/trace.ts";

test("tracing stays off unless asked, and prompt text is hashed", () => {
	const dir = mkdtempSync(join(tmpdir(), "ultimate-pi-trace-"));
	const previousTrace = process.env.ULTIMATE_PI_TRACE;
	const previousDir = process.env.PI_CODING_AGENT_DIR;
	const previousSession = process.env.ULTIMATE_PI_TRACE_SESSION;
	const previousContent = process.env.ULTIMATE_PI_TRACE_CONTENT;
	try {
		process.env.PI_CODING_AGENT_DIR = dir;
		process.env.ULTIMATE_PI_TRACE_SESSION = "session-a";
		delete process.env.ULTIMATE_PI_TRACE_CONTENT;
		process.env.ULTIMATE_PI_TRACE = "0";
		resetTraceForTests();
		traceEvent("jev-triage", { tier: "tier_0", prompt: "secret" });
		assert.throws(() => readFileSync(join(dir, "traces", "session-a.jsonl"), "utf8"));

		process.env.ULTIMATE_PI_TRACE = "1";
		resetTraceForTests();
		traceEvent("jev-triage", { tier: "tier_1", prompt: "fix auth and token=abc" });
		noteIfReviewVerdict(`\`\`\`json\n{"verdict":"APPROVED","findings":[]}\n\`\`\``);
		const text = readFileSync(join(dir, "traces", "session-a.jsonl"), "utf8");
		assert.match(text, /"type":"jev-triage"/);
		assert.match(text, /"type":"review-verdict"/);
		assert.doesNotMatch(text, /fix auth/);
		assert.match(text, /"sha256"/);
		assert.doesNotMatch(text, /token=abc/);
	} finally {
		if (previousTrace === undefined) delete process.env.ULTIMATE_PI_TRACE;
		else process.env.ULTIMATE_PI_TRACE = previousTrace;
		if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousDir;
		if (previousSession === undefined) delete process.env.ULTIMATE_PI_TRACE_SESSION;
		else process.env.ULTIMATE_PI_TRACE_SESSION = previousSession;
		if (previousContent === undefined) delete process.env.ULTIMATE_PI_TRACE_CONTENT;
		else process.env.ULTIMATE_PI_TRACE_CONTENT = previousContent;
		resetTraceForTests();
		rmSync(dir, { recursive: true, force: true });
	}
});
