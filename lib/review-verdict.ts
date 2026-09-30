/**
 * Reviewer output contract. Missing or invalid JSON fails closed as NEEDS CHANGES.
 */

import { traceEvent } from "./trace.ts";

export type ReviewSeverity = "P0" | "P1" | "P2" | "P3";

export type ReviewFinding = {
	severity: ReviewSeverity;
	file: string;
	line?: number;
	issue: string;
	fix: string;
};

export type ReviewVerdict = {
	verdict: "APPROVED" | "NEEDS CHANGES";
	findings: ReviewFinding[];
	parsed: boolean;
};

const SEVERITIES = new Set<ReviewSeverity>(["P0", "P1", "P2", "P3"]);

function failClosed(issue: string): ReviewVerdict {
	return {
		verdict: "NEEDS CHANGES",
		parsed: false,
		findings: [
			{
				severity: "P1",
				file: "",
				issue,
				fix: "Re-run the reviewer and end with one fenced JSON verdict block.",
			},
		],
	};
}

function asFinding(value: unknown): ReviewFinding | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;
	if (!SEVERITIES.has(raw.severity as ReviewSeverity)) return undefined;
	if (typeof raw.issue !== "string" || typeof raw.fix !== "string") return undefined;
	const finding: ReviewFinding = {
		severity: raw.severity as ReviewSeverity,
		file: typeof raw.file === "string" ? raw.file : "",
		issue: raw.issue,
		fix: raw.fix,
	};
	if (typeof raw.line === "number") finding.line = raw.line;
	return finding;
}

export function parseReviewVerdict(text: string): ReviewVerdict {
	const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1]);
	for (const block of blocks.reverse()) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(block);
		} catch {
			continue;
		}
		if (!parsed || typeof parsed !== "object") continue;
		const raw = parsed as Record<string, unknown>;
		if (raw.verdict !== "APPROVED" && raw.verdict !== "NEEDS CHANGES") continue;
		if (!Array.isArray(raw.findings)) return failClosed("Verdict JSON is missing a findings array.");
		const findings: ReviewFinding[] = [];
		for (const entry of raw.findings) {
			const finding = asFinding(entry);
			if (!finding) return failClosed("A finding is missing severity, issue, or fix.");
			findings.push(finding);
		}
		if (raw.verdict === "APPROVED" && findings.some((finding) => finding.severity !== "P3")) {
			return failClosed("APPROVED cannot include a P0, P1, or P2 finding.");
		}
		return { verdict: raw.verdict, findings, parsed: true };
	}
	return failClosed("Reviewer output had no parseable verdict block.");
}

/** Trace a reviewer message once the parent can see it. No-ops when tracing is off. */
export function noteIfReviewVerdict(text: string): ReviewVerdict | undefined {
	if (!/```(?:json)?/i.test(text) || !/"verdict"/.test(text)) return undefined;
	const verdict = parseReviewVerdict(text);
	traceEvent("review-verdict", {
		verdict: verdict.verdict,
		parsed: verdict.parsed,
		findings: verdict.findings.length,
	});
	return verdict;
}
