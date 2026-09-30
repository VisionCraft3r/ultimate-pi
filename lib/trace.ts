/**
 * Opt-in local routing trace. Nothing here is uploaded.
 * Prompt-like fields are stored as a hash and a length unless
 * ULTIMATE_PI_TRACE_CONTENT=1. Values that look like secrets are redacted either way.
 */

import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SECRET = /(?:api[_-]?key|token|secret|password|bearer)\s*[:=]\s*\S+/gi;
const SENSITIVE_KEY = /prompt|request|text|content|command/i;

let seq = 0;
let settingsEnabled: boolean | undefined;

function agentDir(): string {
	const fromEnv = process.env.PI_CODING_AGENT_DIR?.trim();
	if (fromEnv) return fromEnv;
	return join(homedir(), ".pi", "agent");
}

function settingsTrace(): boolean {
	if (settingsEnabled !== undefined) return settingsEnabled;
	try {
		const settings = JSON.parse(readFileSync(join(agentDir(), "settings.json"), "utf8")) as {
			ultimatePiTrace?: unknown;
		};
		settingsEnabled = settings.ultimatePiTrace === true;
	} catch {
		settingsEnabled = false;
	}
	return settingsEnabled;
}

export function traceEnabled(): boolean {
	if (process.env.ULTIMATE_PI_TRACE === "0") return false;
	if (process.env.ULTIMATE_PI_TRACE === "1") return true;
	return settingsTrace();
}

function redact(value: string): string {
	return value.replace(SECRET, "[redacted]");
}

function summarize(key: string, value: string): unknown {
	const clean = redact(value);
	if (process.env.ULTIMATE_PI_TRACE_CONTENT === "1" || !SENSITIVE_KEY.test(key)) return clean;
	return {
		sha256: createHash("sha256").update(clean).digest("hex").slice(0, 16),
		length: clean.length,
	};
}

export function traceEvent(type: string, data: Record<string, unknown> = {}): void {
	if (!traceEnabled()) return;
	const payload: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(data)) {
		payload[key] = typeof value === "string" ? summarize(key, value) : value;
	}
	const session = process.env.PI_SUBAGENT_SESSION || process.env.ULTIMATE_PI_TRACE_SESSION || "main";
	const id = session.split(/[/\\]/).pop()?.replace(/[^\w.-]/g, "") || "main";
	const dir = join(agentDir(), "traces");
	mkdirSync(dir, { recursive: true });
	seq += 1;
	const line = JSON.stringify({
		seq,
		ts: new Date().toISOString(),
		type,
		agent: process.env.PI_SUBAGENT_AGENT || "main",
		subagentId: process.env.PI_SUBAGENT_ID,
		...payload,
	});
	appendFileSync(join(dir, `${id}.jsonl`), `${line}\n`);
}

export function resetTraceForTests(): void {
	seq = 0;
	settingsEnabled = undefined;
}
