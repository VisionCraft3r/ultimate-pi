import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// AGENT_DIR is captured at module load, so point it at a scratch dir before import.
const scratch = mkdtempSync(join(tmpdir(), "upi-fallback-"));
process.env.PI_CODING_AGENT_DIR = scratch;

const { resolveFallbackChain } = await import("../lib/model-agents.ts");
const { deriveDefaultChains } = await import("../lib/quota-fallback.ts");

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
