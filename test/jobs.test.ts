import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	formatJobLines,
	killRecordedJob,
	listJobs,
	wrapBashForJobs,
} from "../lib/jobs.ts";

test("wrap does not nest and keeps the original command", () => {
	const once = wrapBashForJobs("node server.js &", "/tmp/pi-jobs");
	assert.match(once, /node server\.js &/);
	assert.match(once, /__pi_jobs_record/);
	assert.equal(wrapBashForJobs(once, "/tmp/pi-jobs"), once);
});

test("background sleep is recorded and kill removes it", async () => {
	const ledger = await mkdtemp(path.join(tmpdir(), "pi-jobs-"));
	try {
		const wrapped = wrapBashForJobs("sleep 30 &", ledger);
		const exitCode = await new Promise<number | null>((resolve, reject) => {
			const child = spawn("/bin/bash", ["-c", wrapped], { stdio: "ignore" });
			child.on("error", reject);
			child.on("exit", (code) => resolve(code));
		});
		assert.equal(exitCode, 0);
		const jobs = listJobs(ledger);
		assert.equal(jobs.length, 1);
		assert.match(jobs[0].command, /sleep 30/);
		const killed = killRecordedJob(ledger, jobs[0].pid);
		assert.equal(killed?.pid, jobs[0].pid);
		await new Promise((resolve) => setTimeout(resolve, 50));
		assert.equal(listJobs(ledger).length, 0);
		assert.equal(killRecordedJob(ledger, jobs[0].pid), undefined);
	} finally {
		const leftover = listJobs(ledger);
		for (const job of leftover) killRecordedJob(ledger, job.pid);
		await rm(ledger, { recursive: true, force: true });
	}
});

test("list drops a recorded pid that is already dead", async () => {
	const ledger = await mkdtemp(path.join(tmpdir(), "pi-jobs-dead-"));
	try {
		const dead = path.join(ledger, "2000000001");
		await mkdir(dead);
		await writeFile(path.join(dead, "pid"), "2000000001\n");
		await writeFile(path.join(dead, "command"), "node server.js");
		await writeFile(path.join(dead, "cwd"), "/tmp");
		await writeFile(path.join(dead, "agent"), "worker");
		await writeFile(path.join(dead, "started"), "2026-09-28T00:00:00Z");
		assert.match(formatJobLines(listJobs(ledger)), /No background jobs/);
	} finally {
		await rm(ledger, { recursive: true, force: true });
	}
});
