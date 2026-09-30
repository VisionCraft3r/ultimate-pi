import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { diffWave, markWave } from "../lib/wave-diff.ts";

function git(cwd: string, args: string[]) {
	execFileSync("git", args, { cwd, stdio: "ignore" });
}

test("wave diff lists a file created after the mark", () => {
	const cwd = mkdtempSync(join(tmpdir(), "ultimate-pi-wave-"));
	try {
		git(cwd, ["init"]);
		git(cwd, ["config", "user.email", "wave@example.com"]);
		git(cwd, ["config", "user.name", "wave"]);
		writeFileSync(join(cwd, "keep.txt"), "ok\n");
		git(cwd, ["add", "keep.txt"]);
		git(cwd, ["commit", "-m", "init"]);
		const mark = markWave(cwd);
		assert.match(mark.sha, /^[0-9a-f]{40}$/);
		mkdirSync(join(cwd, "src"), { recursive: true });
		writeFileSync(join(cwd, "src", "new.ts"), "export const n = 1;\n");
		writeFileSync(join(cwd, "keep.txt"), "changed\n");
		const diff = diffWave(cwd);
		assert.ok(diff.changed.includes("keep.txt"));
		assert.ok(diff.created.includes("src/new.ts"));
		assert.match(diff.text, /keep\.txt/);
		assert.match(diff.text, /src\/new\.ts/);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
