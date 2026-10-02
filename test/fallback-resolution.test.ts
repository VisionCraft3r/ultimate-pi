import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// AGENT_DIR is captured at module load, so point it at a scratch dir before import.
const scratch = mkdtempSync(join(tmpdir(), "upi-fallback-"));
process.env.PI_CODING_AGENT_DIR = scratch;

const { missingCursorRefs, pidIsRunning, resolveFallbackChain, resolveScopedSwitchChain } = await import("../lib/model-agents.ts");
const { deriveDefaultChains, isQuota429, quotaSignalFromMessage } = await import("../lib/quota-fallback.ts");

const ASSIGNMENTS = join(scratch, "model-agents.json");

const AGENT_CHAIN = [{ provider: "openai", id: "test-agent-model" }];
const PROVIDER_CHAIN = [{ provider: "cursor", id: "test-provider-model" }];
const DEFAULT_CHAIN = [{ provider: "openrouter", id: "test-default-model" }];
const DEFAULTS = { anthropic: DEFAULT_CHAIN };

function writeAssignments(data: Record<string, unknown>): void {
	writeFileSync(ASSIGNMENTS, `${JSON.stringify(data, null, 2)}\n`);
}

beforeEach(() => {
	writeAssignments({});
});

after(() => {
	rmSync(scratch, { recursive: true, force: true });
});

test("agentFallbacks[agentName] wins when present and valid", () => {
	writeAssignments({
		agentFallbacks: { worker: AGENT_CHAIN },
		fallbacks: { anthropic: PROVIDER_CHAIN },
	});
	assert.deepEqual(resolveFallbackChain("anthropic", DEFAULTS, "worker"), AGENT_CHAIN);
	assert.deepEqual(resolveFallbackChain("anthropic", DEFAULTS, "main"), PROVIDER_CHAIN);
});

test("falls back to fallbacks[provider] when no agent-specific chain", () => {
	writeAssignments({
		fallbacks: { anthropic: PROVIDER_CHAIN },
	});
	assert.deepEqual(resolveFallbackChain("anthropic", DEFAULTS, "worker"), PROVIDER_CHAIN);
	assert.deepEqual(resolveFallbackChain("anthropic", DEFAULTS), PROVIDER_CHAIN);
});

test("empty or invalid agentFallbacks fall through to fallbacks[provider]", () => {
	writeAssignments({
		agentFallbacks: { worker: [] },
		fallbacks: { anthropic: PROVIDER_CHAIN },
	});
	assert.deepEqual(resolveFallbackChain("anthropic", DEFAULTS, "worker"), PROVIDER_CHAIN);
});

test("falls back to defaults[provider] when neither assignment is set", () => {
	writeAssignments({});
	assert.deepEqual(resolveFallbackChain("anthropic", DEFAULTS, "worker"), DEFAULT_CHAIN);
	assert.deepEqual(resolveFallbackChain("anthropic", DEFAULTS), DEFAULT_CHAIN);
});

test("returns [] when nothing matches", () => {
	writeAssignments({
		fallbacks: { openai: PROVIDER_CHAIN },
	});
	assert.deepEqual(resolveFallbackChain("anthropic", {}, "worker"), []);
	assert.deepEqual(resolveFallbackChain("unknown", DEFAULTS), []);
});

test("scoped switch ignores derived defaults and models outside the scope", () => {
	writeAssignments({
		fallbacks: {
			anthropic: [
				{ provider: "cursor", id: "cursor-grok-4.6-medium" },
				{ provider: "openai", id: "not-scoped" },
			],
		},
	});
	const scoped = ["cursor/cursor-grok-4.6-medium", "anthropic/claude-sonnet-5"];
	assert.deepEqual(resolveScopedSwitchChain("anthropic", DEFAULTS, "worker", scoped), [
		{ provider: "cursor", id: "cursor-grok-4.6-medium" },
	]);
	writeAssignments({});
	assert.deepEqual(resolveScopedSwitchChain("anthropic", DEFAULTS, "worker", []), DEFAULT_CHAIN);
	assert.deepEqual(resolveScopedSwitchChain("anthropic", DEFAULTS, "worker", scoped), []);
});

test("a Cursor connect resource_exhausted is not a quota signal", () => {
	const text = "[Error: Connect error resource_exhausted: Error (retries exhausted)]";
	assert.equal(isQuota429(undefined, text), false);
	assert.equal(isQuota429(undefined, "retry failed after 3 attempts"), false);
	assert.equal(
		quotaSignalFromMessage({
			role: "assistant",
			stopReason: "stop",
			content: [{ type: "text", text: `\n${text}` }],
		}),
		"",
	);
	assert.equal(isQuota429(429, ""), true);
	assert.equal(isQuota429(undefined, "rate_limit_error"), true);
	assert.equal(isQuota429(undefined, "You have exceeded your account's rate limit."), true);
	assert.equal(
		isQuota429(undefined, '400 {"type":"error","error":{"message":"Third-party apps now draw from your extra usage, not your plan limits."}}'),
		true,
	);
	assert.equal(
		quotaSignalFromMessage({
			role: "assistant",
			content: [{ type: "text", text: `The handler mentions resource_exhausted in a long explanation. ${"x".repeat(500)}` }],
		}),
		"",
	);
});

test("assigned cursor refs missing from the catalog are reported", () => {
	const catalog = ["grok-4.7", "composer-2.5"];
	assert.deepEqual(missingCursorRefs(catalog, ["cursor/grok-4.7", "anthropic/claude-opus-5-5"]), []);
	assert.deepEqual(missingCursorRefs(catalog, ["cursor/cursor-grok-4.6-medium", "cursor/grok-4.7"]), [
		"cursor/cursor-grok-4.6-medium",
	]);
});

test("the current process counts as a live proxy pid", () => {
	assert.equal(pidIsRunning(process.pid), true);
	assert.equal(pidIsRunning(0), false);
	assert.equal(pidIsRunning(2_147_483_646), false);
});

test("deriveDefaultChains produces a chain that excludes the provider itself", () => {
	const chains = deriveDefaultChains(["anthropic", "openai", "cursor", "not-a-real-provider"]);
	assert.deepEqual(Object.keys(chains).sort(), ["anthropic", "cursor", "openai"]);
	assert.equal("not-a-real-provider" in chains, false);

	assert.deepEqual(
		chains.anthropic.map((spec) => spec.provider),
		["cursor", "openai"],
	);
	assert.deepEqual(
		chains.cursor.map((spec) => spec.provider),
		["anthropic", "openai"],
	);
	assert.deepEqual(
		chains.openai.map((spec) => spec.provider),
		["anthropic", "cursor"],
	);

	for (const [provider, chain] of Object.entries(chains)) {
		assert.equal(
			chain.some((spec) => spec.provider === provider),
			false,
			`${provider} must not appear in its own derived chain`,
		);
		assert.ok(chain.length > 0);
		assert.ok(chain.every((spec) => spec.id === "default"));
	}
});
