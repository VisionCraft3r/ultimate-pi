/**
 * Context bar and git dirty line for the session-chrome widget.
 * No Pi imports: the extension maps `level` onto the theme.
 */

import { execFile } from "node:child_process";

export const BAR_CELLS = 12;
const GIT_TIMEOUT_MS = 1500;

export type ContextLevel = "ok" | "warning" | "error" | "unknown";

export type ContextBar = {
	level: ContextLevel;
	bar: string;
	percentLabel: string;
	tokensLabel: string;
};

export type GitCounts = {
	files: number;
	insertions: number;
	deletions: number;
};

export type GitSnapshot =
	| { repo: false }
	| ({ repo: true; branch: string } & GitCounts);

/** Compact token counts, same cutoffs as Pi's footer. */
export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

/** Matches Pi's footer: warning above 70%, error above 90%. */
export function contextLevel(percent: number | null): ContextLevel {
	if (percent === null || !Number.isFinite(percent)) return "unknown";
	if (percent > 90) return "error";
	if (percent > 70) return "warning";
	return "ok";
}

function percentLabel(percent: number | null): string {
	if (percent === null || !Number.isFinite(percent)) return "?";
	const rounded = Math.round(percent * 10) / 10;
	return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

export function formatContextBar(input: {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}): ContextBar {
	const level = contextLevel(input.percent);
	const ratio = level === "unknown" || input.percent === null ? 0 : input.percent / 100;
	const filled = Math.min(BAR_CELLS, Math.max(0, Math.round(ratio * BAR_CELLS)));
	const windowLabel = input.contextWindow > 0 ? formatTokens(input.contextWindow) : "?";
	const usedLabel = input.tokens === null ? "?" : formatTokens(input.tokens);
	return {
		level,
		bar: `${"█".repeat(filled)}${"░".repeat(BAR_CELLS - filled)}`,
		percentLabel: percentLabel(input.percent),
		tokensLabel: `${usedLabel}/${windowLabel}`,
	};
}

/** Shortstat file count plus untracked paths from porcelain. Insertions stay on the shortstat. */
export function countsFromGit(shortstat: string, porcelain: string): GitCounts {
	const files = shortstat.match(/(\d+)\s+files?\s+changed/);
	const insertions = shortstat.match(/(\d+)\s+insertions?\(\+\)/);
	const deletions = shortstat.match(/(\d+)\s+deletions?\(-\)/);
	const untracked = porcelain.split("\n").filter((line) => line.startsWith("??")).length;
	return {
		files: (files ? Number(files[1]) : 0) + untracked,
		insertions: insertions ? Number(insertions[1]) : 0,
		deletions: deletions ? Number(deletions[1]) : 0,
	};
}

export function formatGitLine(branch: string, counts: GitCounts): string {
	const name = branch.trim() || "HEAD";
	if (counts.files === 0 && counts.insertions === 0 && counts.deletions === 0) return name;
	const files = `${counts.files} file${counts.files === 1 ? "" : "s"}`;
	return `${name}  +${counts.insertions} −${counts.deletions}  ${files}`;
}

function runGit(cwd: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			"git",
			args,
			{ cwd, timeout: GIT_TIMEOUT_MS, encoding: "utf8", maxBuffer: 1_048_576, windowsHide: true },
			(error, stdout) => {
				if (error) reject(error);
				else resolve(String(stdout));
			},
		);
	});
}

export async function readGitSnapshot(cwd: string): Promise<GitSnapshot> {
	try {
		const inside = (await runGit(cwd, ["rev-parse", "--is-inside-work-tree"])).trim();
		if (inside !== "true") return { repo: false };
	} catch {
		return { repo: false };
	}

	const [branchRaw, shortstat, porcelain] = await Promise.all([
		runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "HEAD"),
		runGit(cwd, ["diff", "--shortstat", "HEAD"]).catch(() => runGit(cwd, ["diff", "--shortstat"]).catch(() => "")),
		runGit(cwd, ["status", "--porcelain"]).catch(() => ""),
	]);
	const branch = branchRaw.trim() || "HEAD";
	return { repo: true, branch, ...countsFromGit(shortstat, porcelain) };
}
