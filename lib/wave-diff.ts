/**
 * Parent-side record of a worker wave. The reviewer should see this diff,
 * not the worker's own summary of what it touched.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { presentCapped } from "./output-cap.ts";

export type WaveMark = {
	sha: string;
	porcelain: string[];
	cwd: string;
};

function markFile(cwd: string): string {
	return join(cwd, ".pi", "wave-mark.json");
}

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

export function readWaveMark(cwd: string): WaveMark | undefined {
	const file = markFile(cwd);
	if (!existsSync(file)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as WaveMark;
		if (!parsed || typeof parsed.sha !== "string") return undefined;
		return parsed;
	} catch {
		return undefined;
	}
}

export function markWave(cwd: string): WaveMark {
	const sha = git(cwd, ["rev-parse", "HEAD"]);
	const porcelain = git(cwd, ["status", "--porcelain"]).split("\n").filter(Boolean);
	const mark: WaveMark = { sha, porcelain, cwd };
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(markFile(cwd), `${JSON.stringify(mark, null, 2)}\n`);
	return mark;
}

export function diffWave(cwd: string): { text: string; changed: string[]; created: string[] } {
	const mark = readWaveMark(cwd);
	if (!mark) {
		return { text: "No wave mark. Call wave_diff with action mark before the worker wave.", changed: [], created: [] };
	}
	const stat = git(cwd, ["diff", "--stat", mark.sha]);
	const names = git(cwd, ["diff", "--name-only", mark.sha]).split("\n").filter(Boolean);
	const untracked = git(cwd, ["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
	const changed = [...new Set([...names, ...untracked])];
	const body = [
		`Since ${mark.sha.slice(0, 12)}`,
		stat || "(no tracked diff)",
		untracked.length ? `Untracked:\n${untracked.map((file) => `- ${file}`).join("\n")}` : "",
	]
		.filter(Boolean)
		.join("\n\n");
	return { text: presentCapped(body), changed, created: untracked };
}
