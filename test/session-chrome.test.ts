import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	BAR_CELLS,
	countsFromGit,
	formatContextBar,
	formatGitLine,
	readGitSnapshot,
} from "../lib/session-chrome.ts";

function git(cwd: string, args: string[]) {
	execFileSync("git", args, { cwd, stdio: "ignore" });
}

test("an empty context bar is ok and unfilled", () => {
	const bar = formatContextBar({ tokens: 0, contextWindow: 200_000, percent: 0 });
	assert.equal(bar.level, "ok");
	assert.equal(bar.bar, "░".repeat(BAR_CELLS));
	assert.equal(bar.percentLabel, "0%");
	assert.equal(bar.tokensLabel, "0/200k");
});

test("context level is warning above 70% and error above 90%", () => {
	assert.equal(formatContextBar({ tokens: 140_000, contextWindow: 200_000, percent: 70 }).level, "ok");
	assert.equal(formatContextBar({ tokens: 142_000, contextWindow: 200_000, percent: 71 }).level, "warning");
	assert.equal(formatContextBar({ tokens: 180_000, contextWindow: 200_000, percent: 90 }).level, "warning");
	assert.equal(formatContextBar({ tokens: 182_000, contextWindow: 200_000, percent: 91 }).level, "error");
});

test("unknown usage shows a question mark and no filled bar", () => {
	const bar = formatContextBar({ tokens: null, contextWindow: 200_000, percent: null });
	assert.equal(bar.level, "unknown");
	assert.equal(bar.percentLabel, "?");
	assert.equal(bar.tokensLabel, "?/200k");
	assert.equal(bar.bar, "░".repeat(BAR_CELLS));
});

test("git counts add untracked files on top of the shortstat", () => {
	const counts = countsFromGit(
		" 2 files changed, 128 insertions(+), 40 deletions(-)\n",
		" M tracked.ts\n?? new.ts\n",
	);
	assert.deepEqual(counts, { files: 3, insertions: 128, deletions: 40 });
	assert.equal(formatGitLine("main", counts), "main  +128 −40  3 files");
	assert.equal(formatGitLine("main", { files: 0, insertions: 0, deletions: 0 }), "main");
});

test("a directory that is not a git repo has no git line", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "ultimate-pi-chrome-"));
	try {
		const snapshot = await readGitSnapshot(cwd);
		assert.deepEqual(snapshot, { repo: false });
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("a worktree snapshot includes the shortstat and an untracked file", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "ultimate-pi-chrome-git-"));
	try {
		git(cwd, ["init"]);
		git(cwd, ["config", "user.email", "chrome@example.com"]);
		git(cwd, ["config", "user.name", "chrome"]);
		writeFileSync(join(cwd, "keep.txt"), "ok\n");
		git(cwd, ["add", "keep.txt"]);
		git(cwd, ["commit", "-m", "init"]);
		writeFileSync(join(cwd, "keep.txt"), "ok\nchanged\n");
		writeFileSync(join(cwd, "new.txt"), "extra\n");
		const snapshot = await readGitSnapshot(cwd);
		assert.equal(snapshot.repo, true);
		if (!snapshot.repo) return;
		assert.equal(snapshot.files, 2);
		assert.equal(snapshot.insertions, 1);
		assert.equal(snapshot.deletions, 0);
		assert.match(formatGitLine(snapshot.branch, snapshot), /\+1 −0  2 files/);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
