/**
 * Bound text that would otherwise land in a model context.
 * Spill the full text to a file only when the current role can read it.
 * researcher and qa_tester have no read tool, so they get the marker only.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DEFAULT_OUTPUT_CAP_CHARS = 12_000;

const READ_ROLES = new Set(["scout", "worker", "planner", "reviewer"]);

export function currentRoleCanRead(agent = process.env.PI_SUBAGENT_AGENT): boolean {
	const name = agent?.trim();
	if (!name) return true;
	return READ_ROLES.has(name);
}

export function capText(
	text: string,
	maxChars = DEFAULT_OUTPUT_CAP_CHARS,
): { text: string; truncated: boolean; omitted: number } {
	if (text.length <= maxChars) return { text, truncated: false, omitted: 0 };
	const markerBudget = 64;
	const body = Math.max(0, maxChars - markerBudget);
	const head = Math.floor(body * 0.75);
	const tail = Math.max(0, body - head);
	const omitted = text.length - head - tail;
	const marker = `\n\n…[truncated ${omitted} characters]…\n\n`;
	return { text: text.slice(0, head) + marker + (tail > 0 ? text.slice(-tail) : ""), truncated: true, omitted };
}

export function presentCapped(
	text: string,
	options?: { maxChars?: number; spill?: boolean },
): string {
	const maxChars = options?.maxChars ?? DEFAULT_OUTPUT_CAP_CHARS;
	if (text.length <= maxChars) return text;
	const spill = options?.spill ?? currentRoleCanRead();
	let note = "";
	if (spill) {
		const dir = join(tmpdir(), "ultimate-pi-output");
		mkdirSync(dir, { recursive: true });
		const name = `${createHash("sha256").update(text).digest("hex").slice(0, 16)}.txt`;
		const file = join(dir, name);
		writeFileSync(file, text);
		note = `\nFull text: ${file}`;
	}
	return capText(text, Math.max(1, maxChars - note.length)).text + note;
}
