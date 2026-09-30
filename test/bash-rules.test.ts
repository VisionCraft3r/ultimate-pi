import assert from "node:assert/strict";
import { test } from "node:test";
import { FLOOR_RULES, evaluateDisabledMainBash, evaluateHeadlessBash } from "../extensions/bash-guard/rules.ts";
import { checkBashCommand, parseUserRules } from "../lib/bash-policy.ts";

test("every floor rule's examples match and the counterexamples do not", () => {
	for (const rule of FLOOR_RULES) {
		for (const sample of rule.match) {
			assert.equal(rule.pattern.test(sample), true, `${rule.id} should match ${sample}`);
		}
		for (const sample of rule.notMatch) {
			assert.equal(rule.pattern.test(sample), false, `${rule.id} should not match ${sample}`);
		}
		for (const sample of rule.match) {
			const headless = evaluateHeadlessBash(sample);
			const main = evaluateDisabledMainBash(sample);
			if (rule.subagentAllow) assert.equal(headless, undefined, rule.id);
			else assert.equal(headless?.block, true, rule.id);
			if (rule.mainFloor) assert.equal(main?.block, true, rule.id);
			else assert.equal(main, undefined, rule.id);
		}
	}
});

test("a user allow cannot relax the floor, and a user forbid tightens", () => {
	const relaxed = parseUserRules(
		JSON.stringify({
			rules: [
				{
					pattern: "\\bsudo\\b",
					decision: "allow",
					match: ["sudo true"],
				},
			],
		}),
	);
	assert.equal(relaxed.rules.length, 0);
	assert.match(relaxed.dropped.join(" "), /catastrophic floor/);

	const tighter = parseUserRules(
		JSON.stringify({
			rules: [
				{
					pattern: "\\bnpm\\s+publish\\b",
					decision: "forbidden",
					justification: "publishing is a parent-session action",
					alternative: "ask the parent to publish",
					match: ["npm publish"],
					notMatch: ["npm install"],
				},
			],
		}),
	);
	assert.equal(tighter.rules.length, 1);
	const decision = checkBashCommand("npm publish", { headless: true, rules: tighter.rules });
	assert.equal(decision.decision, "forbidden");
	assert.equal(decision.source, "user");
	assert.match(decision.alternative ?? "", /parent/);
});

test("a malformed rules file keeps no user rules", () => {
	const loaded = parseUserRules("{");
	assert.equal(loaded.rules.length, 0);
	assert.ok(loaded.error);
});
