import assert from "node:assert/strict";
import { test } from "node:test";
import install, { evaluateDisabledMainBash } from "../extensions/bash-guard/index.ts";

/** Minimal ExtensionAPI stub that captures the main-session tool_call handler. */
function mockMainSessionPi() {
	const handlers: Record<string, (...args: any[]) => unknown> = {};
	const pi = {
		on(event: string, handler: (...args: any[]) => unknown) {
			handlers[event] = handler;
		},
		registerFlag() {},
		registerCommand() {},
		getFlag() {
			return false;
		},
	};
	install(pi as any);
	return { handlers };
}

test("disabled-path catastrophic floor blocks rm -rf (MAIN_DISABLED_BLOCKED)", () => {
	const result = evaluateDisabledMainBash("rm -rf /tmp/example");
	assert.equal(result?.block, true);
	assert.match(result?.reason ?? "", /recursive delete/i);
});

test("disabled-path catastrophic floor blocks sudo", () => {
	const result = evaluateDisabledMainBash("sudo true");
	assert.equal(result?.block, true);
	assert.match(result?.reason ?? "", /elevated privileges/i);
});

test("disabled-path catastrophic floor allows git commit (filtered out of MAIN_DISABLED_BLOCKED)", () => {
	assert.equal(evaluateDisabledMainBash("git commit -m wip"), undefined);
});

test("disabled-path catastrophic floor allows a harmless command", () => {
	assert.equal(evaluateDisabledMainBash("ls -la"), undefined);
});

test("main-session extension applies MAIN_DISABLED_BLOCKED while disabled (rm -rf)", async () => {
	const { handlers } = mockMainSessionPi();
	assert.equal(typeof handlers.tool_call, "function");
	// SAFETY: mock harness returns a loosely-typed handler result; narrow it for assertion access only.
	const result = (await handlers.tool_call(
		{ toolName: "bash", input: { command: "rm -rf /tmp/example" } },
		{ hasUI: false },
	)) as { block?: boolean; reason?: string } | undefined;
	assert.equal(result?.block, true);
	assert.match(result?.reason ?? "", /catastrophic-operation floor remains in effect/);
});

test("main-session extension allows git commit while disabled", async () => {
	const { handlers } = mockMainSessionPi();
	const result = await handlers.tool_call(
		{ toolName: "bash", input: { command: "git commit -m wip" } },
		{ hasUI: false },
	);
	assert.equal(result, undefined);
});
