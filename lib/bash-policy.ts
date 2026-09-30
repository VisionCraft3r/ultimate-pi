/**
 * Optional <agentDir>/bash-rules.json.
 * User rules may forbid or prompt. An allow rule may only relax a prompt-level
 * command, and only when its match examples are not already on the floor.
 * A malformed file keeps the built-in floor and is reported once.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { floorRuleFor, evaluateDisabledMainBash, evaluateHeadlessBash } from "../extensions/bash-guard/rules.ts";

export type UserDecision = "allow" | "prompt" | "forbidden";

export type CompiledUserRule = {
	pattern: RegExp;
	decision: UserDecision;
	justification: string;
	alternative: string;
};

export type UserRulesLoad = {
	rules: CompiledUserRule[];
	error?: string;
	dropped: string[];
};

export type BashCheck = {
	decision: UserDecision;
	reason?: string;
	justification?: string;
	alternative?: string;
	source: "floor" | "user" | "none";
};

const DECISIONS = new Set<UserDecision>(["allow", "prompt", "forbidden"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asStringList(value: unknown): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return undefined;
	return value as string[];
}

function hitsFloor(command: string): boolean {
	return Boolean(evaluateHeadlessBash(command) || evaluateDisabledMainBash(command));
}

export function parseUserRules(text: string): UserRulesLoad {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (err) {
		return { rules: [], dropped: [], error: err instanceof Error ? err.message : String(err) };
	}
	if (!isRecord(parsed) || !Array.isArray(parsed.rules)) {
		return { rules: [], dropped: [], error: "bash-rules.json must be an object with a rules array" };
	}

	const rules: CompiledUserRule[] = [];
	const dropped: string[] = [];
	for (const [index, raw] of parsed.rules.entries()) {
		const label = `rules[${index}]`;
		if (!isRecord(raw) || typeof raw.pattern !== "string" || !DECISIONS.has(raw.decision as UserDecision)) {
			dropped.push(`${label} needs pattern and decision allow|prompt|forbidden`);
			continue;
		}
		let pattern: RegExp;
		try {
			pattern = new RegExp(raw.pattern);
		} catch (err) {
			dropped.push(`${label} pattern does not compile: ${err instanceof Error ? err.message : err}`);
			continue;
		}
		const match = asStringList(raw.match);
		const notMatch = asStringList(raw.notMatch);
		if (raw.match !== undefined && !match) {
			dropped.push(`${label} match must be an array of strings`);
			continue;
		}
		if (raw.notMatch !== undefined && !notMatch) {
			dropped.push(`${label} notMatch must be an array of strings`);
			continue;
		}
		const missed = (match ?? []).filter((sample) => !pattern.test(sample));
		const unexpected = (notMatch ?? []).filter((sample) => pattern.test(sample));
		if (missed.length || unexpected.length) {
			dropped.push(`${label} failed its own examples`);
			continue;
		}
		const decision = raw.decision as UserDecision;
		if (decision === "allow") {
			if (!match || match.length === 0) {
				dropped.push(`${label} allow rules must include match examples`);
				continue;
			}
			if (match.some((sample) => hitsFloor(sample))) {
				dropped.push(`${label} cannot relax the catastrophic floor`);
				continue;
			}
		}
		rules.push({
			pattern,
			decision,
			justification: typeof raw.justification === "string" ? raw.justification : "",
			alternative: typeof raw.alternative === "string" ? raw.alternative : "",
		});
	}
	return { rules, dropped };
}

export function readUserRules(agentDir: string): UserRulesLoad {
	const file = join(agentDir, "bash-rules.json");
	if (!existsSync(file)) return { rules: [], dropped: [] };
	try {
		return parseUserRules(readFileSync(file, "utf8"));
	} catch (err) {
		return { rules: [], dropped: [], error: err instanceof Error ? err.message : String(err) };
	}
}

let loggedMalformed = false;

/** Built-ins stay in force. A bad user file is logged once per process. */
export function readUserRulesLogged(agentDir: string): CompiledUserRule[] {
	const loaded = readUserRules(agentDir);
	if ((loaded.error || loaded.dropped.length > 0) && !loggedMalformed) {
		loggedMalformed = true;
		const detail = loaded.error ?? loaded.dropped.join("; ");
		console.error(`bash-rules.json ignored in part: ${detail}`);
	}
	return loaded.rules;
}

export function checkBashCommand(
	command: string,
	options: { headless: boolean; rules?: CompiledUserRule[] },
): BashCheck {
	const floor = options.headless ? evaluateHeadlessBash(command) : evaluateDisabledMainBash(command);
	if (floor) {
		const rule = floorRuleFor(command, options.headless);
		return {
			decision: "forbidden",
			reason: floor.reason,
			justification: rule?.justification,
			alternative: rule?.alternative,
			source: "floor",
		};
	}
	const rules = options.rules ?? [];
	for (const rule of rules) {
		if (rule.decision === "allow" || !rule.pattern.test(command)) continue;
		if (rule.decision === "forbidden" || options.headless) {
			return {
				decision: "forbidden",
				reason: "Blocked by user bash rule.",
				justification: rule.justification,
				alternative: rule.alternative,
				source: "user",
			};
		}
		return {
			decision: "prompt",
			reason: "User bash rule asks for confirmation.",
			justification: rule.justification,
			alternative: rule.alternative,
			source: "user",
		};
	}
	for (const rule of rules) {
		if (rule.decision === "allow" && rule.pattern.test(command)) {
			return { decision: "allow", justification: rule.justification, source: "user" };
		}
	}
	return { decision: "allow", source: "none" };
}

/** Interactive main session: a user allow skips the prompt; a user prompt forces one. */
export function userInteractiveOverride(
	command: string,
	rules: CompiledUserRule[],
): "block" | "prompt" | "allow" | undefined {
	const checked = checkBashCommand(command, { headless: false, rules });
	if (checked.source !== "user") return undefined;
	if (checked.decision === "forbidden") return "block";
	if (checked.decision === "prompt") return "prompt";
	if (checked.decision === "allow" && !hitsFloor(command)) return "allow";
	return undefined;
}
