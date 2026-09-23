import assert from "node:assert/strict";
import { test } from "node:test";
import install, {
	evaluateDisabledMainBash,
	evaluateHeadlessBash,
	analyzeBashCommand,
} from "../extensions/bash-guard/index.ts";

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
	assert.match(result?.reason ?? "", /recursive delete/i);
});

test("main-session extension allows git commit while disabled", async () => {
	const { handlers } = mockMainSessionPi();
	const result = await handlers.tool_call(
		{ toolName: "bash", input: { command: "git commit -m wip" } },
		{ hasUI: false },
	);
	assert.equal(result, undefined);
});

test("subagent headless floor allows git commit and git add (local-only allowlist)", () => {
	assert.equal(evaluateHeadlessBash("git commit -m wip"), undefined);
	assert.equal(evaluateHeadlessBash("git add extensions/bash-guard/index.ts"), undefined);
});

test("subagent headless floor still blocks git push and git pull", () => {
	const push = evaluateHeadlessBash("git push origin main");
	assert.equal(push?.block, true);
	assert.match(push?.reason ?? "", /git push/i);
	const pull = evaluateHeadlessBash("git pull");
	assert.equal(pull?.block, true);
	assert.match(pull?.reason ?? "", /git pull/i);
});

test("subagent headless floor blocks git commit && git push (remote still denied)", () => {
	const result = evaluateHeadlessBash('git commit -m wip && git push');
	assert.equal(result?.block, true);
	assert.match(result?.reason ?? "", /git push/i);
});

test("interactive analyzer does not flag routine git or read-only lsblk", () => {
	assert.equal(analyzeBashCommand("git status"), null);
	assert.equal(analyzeBashCommand("git commit -m wip"), null);
	assert.equal(analyzeBashCommand("git add -A"), null);
	assert.equal(analyzeBashCommand("lsblk"), null);
});

test("interactive analyzer flags risky git subcommands", () => {
	const force = analyzeBashCommand("git push --force origin main");
	assert.equal(force?.severity, "high");
	assert.match(force?.reasons.join(" ") ?? "", /push --force/);
	const reset = analyzeBashCommand("git reset --hard HEAD");
	assert.equal(reset?.severity, "high");
	assert.match(reset?.reasons.join(" ") ?? "", /reset --hard/);
	const clean = analyzeBashCommand("git clean -fd");
	assert.equal(clean?.severity, "high");
	assert.match(clean?.reasons.join(" ") ?? "", /git clean/);
});

test("interactive analyzer flags interpreter -c/-e snippets with destructive commands", () => {
	const py = analyzeBashCommand(`python -c "import os; os.system('rm -rf /tmp/x')"`);
	assert.equal(py?.severity, "high");
	assert.match(py?.reasons.join(" ") ?? "", /rm -r/);

	const node = analyzeBashCommand(`node -e "require('child_process').execSync('sudo true')"`);
	assert.equal(node?.severity, "high");
	assert.match(node?.reasons.join(" ") ?? "", /sudo/);

	const perl = analyzeBashCommand(`perl -e 'system("mkfs.ext4 /dev/sda")'`);
	assert.equal(perl?.severity, "high");
	assert.match(perl?.reasons.join(" ") ?? "", /mkfs/);

	const ruby = analyzeBashCommand(`ruby -e 'system("dd if=/dev/zero of=/dev/sda")'`);
	assert.equal(ruby?.severity, "high");
	assert.match(ruby?.reasons.join(" ") ?? "", /dd with output/);
});

test("interactive analyzer allows benign interpreter one-liners", () => {
	assert.equal(analyzeBashCommand(`python -c "print(1+1)"`), null);
	assert.equal(analyzeBashCommand(`node -e "console.log('ok')"`), null);
	assert.equal(analyzeBashCommand(`perl -e 'print 1'`), null);
	assert.equal(analyzeBashCommand(`ruby -e 'puts 1'`), null);
});

test("interactive analyzer flags xargs rm including piped forms", () => {
	const direct = analyzeBashCommand("xargs rm -rf");
	assert.equal(direct?.severity, "high");
	assert.match(direct?.reasons.join(" ") ?? "", /xargs rm/);

	const piped = analyzeBashCommand("find . -name '*.tmp' | xargs rm");
	assert.equal(piped?.severity, "high");
	assert.match(piped?.reasons.join(" ") ?? "", /xargs rm/);
});
