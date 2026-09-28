/**
 * Ledger of background processes left behind by the bash tool.
 * Lives in lib/ so Pi does not load it as an extension.
 *
 * The bash tool's shell exits when the command returns. A server started
 * with `&` stays in that shell's job table until exit. The wrapper records
 * those pids. Processes that fully daemonize out of the job table are not
 * recorded.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const JOBS_WRAP_MARKER = "__pi_jobs_record";

export type JobRecord = {
	pid: number;
	command: string;
	cwd: string;
	agent: string;
	started: string;
};

export function resolveAgentDir(): string {
	const fromEnv = process.env.PI_CODING_AGENT_DIR;
	if (fromEnv && fromEnv.trim()) return fromEnv;
	return path.join(homedir(), ".pi", "agent");
}

export function jobsDir(agentDir = resolveAgentDir()): string {
	return path.join(agentDir, "jobs");
}

function shellSingleQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Prefix a bash command so background jobs are written into the ledger on exit. */
export function wrapBashForJobs(command: string, ledgerDir: string): string {
	if (command.includes(JOBS_WRAP_MARKER)) return command;
	const marker = `PI_JOBS_CMD_${Math.random().toString(16).slice(2)}`;
	const dir = shellSingleQuote(ledgerDir);
	const meta = shellSingleQuote(path.join(ledgerDir, `.meta-${marker}`));
	return [
		"set -m",
		`mkdir -p ${dir}`,
		`cat > ${meta} <<'${marker}'`,
		command,
		marker,
		`${JOBS_WRAP_MARKER}() {`,
		`  local status="$1"`,
		`  local pid`,
		`  while IFS= read -r pid; do`,
		`    [ -n "$pid" ] || continue`,
		`    mkdir -p ${dir}/"$pid"`,
		`    printf '%s\\n' "$pid" > ${dir}/"$pid"/pid`,
		`    cp ${meta} ${dir}/"$pid"/command`,
		`    printf '%s\\n' "$PWD" > ${dir}/"$pid"/cwd`,
		`    printf '%s\\n' "\${PI_SUBAGENT_AGENT:-parent}" > ${dir}/"$pid"/agent`,
		`    date -u +%Y-%m-%dT%H:%M:%SZ > ${dir}/"$pid"/started`,
		`  done < <(jobs -pr 2>/dev/null)`,
		`  rm -f ${meta}`,
		`  exit "$status"`,
		`}`,
		`trap '${JOBS_WRAP_MARKER} $?' EXIT`,
		`source ${meta}`,
	].join("\n");
}

function readField(dir: string, name: string): string {
	try {
		return readFileSync(path.join(dir, name), "utf8").replace(/\s+$/, "");
	} catch {
		return "";
	}
}

function pidAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 1) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export function listJobs(ledgerDir: string): JobRecord[] {
	let names: string[] = [];
	try {
		names = readdirSync(ledgerDir);
	} catch {
		return [];
	}
	const jobs: JobRecord[] = [];
	for (const name of names) {
		if (!/^\d+$/.test(name)) continue;
		const dir = path.join(ledgerDir, name);
		const pid = Number(name);
		if (!pidAlive(pid)) {
			rmSync(dir, { recursive: true, force: true });
			continue;
		}
		jobs.push({
			pid,
			command: readField(dir, "command").replace(/\s+/g, " ").trim(),
			cwd: readField(dir, "cwd"),
			agent: readField(dir, "agent") || "parent",
			started: readField(dir, "started"),
		});
	}
	jobs.sort((a, b) => a.pid - b.pid);
	return jobs;
}

function childPids(pid: number): number[] {
	const result = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
	if (result.status !== 0 || !result.stdout) return [];
	return result.stdout
		.split("\n")
		.map((line) => Number(line.trim()))
		.filter((child) => Number.isInteger(child) && child > 1);
}

function killTree(pid: number, seen = new Set<number>()): void {
	if (seen.has(pid) || pid <= 1) return;
	seen.add(pid);
	for (const child of childPids(pid)) killTree(child, seen);
	try {
		process.kill(pid, "SIGTERM");
	} catch {
		// already gone
	}
}

/** Kill a ledger pid and its children. Refuses any pid that is not recorded. */
export function killRecordedJob(ledgerDir: string, pid: number): JobRecord | undefined {
	const job = listJobs(ledgerDir).find((entry) => entry.pid === pid);
	if (!job) return undefined;
	killTree(pid);
	rmSync(path.join(ledgerDir, String(pid)), { recursive: true, force: true });
	return job;
}

export function formatJobLines(jobs: JobRecord[]): string {
	if (jobs.length === 0) return "No background jobs.";
	return jobs
		.map((job) => `${job.pid}  ${job.agent}  ${job.command.slice(0, 80) || "(no command)"}`)
		.join("\n");
}
