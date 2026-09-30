import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReviewVerdict } from "../lib/review-verdict.ts";

test("a fenced JSON verdict is parsed", () => {
	const text = `## Verdict
NEEDS CHANGES

\`\`\`json
{"verdict":"NEEDS CHANGES","findings":[{"severity":"P1","file":"src/a.ts","line":4,"issue":"null deref","fix":"guard the read"}]}
\`\`\``;
	const parsed = parseReviewVerdict(text);
	assert.equal(parsed.parsed, true);
	assert.equal(parsed.verdict, "NEEDS CHANGES");
	assert.equal(parsed.findings[0]?.file, "src/a.ts");
	assert.equal(parsed.findings[0]?.line, 4);
});

test("missing JSON fails closed", () => {
	const parsed = parseReviewVerdict("## Verdict\nAPPROVED\n");
	assert.equal(parsed.parsed, false);
	assert.equal(parsed.verdict, "NEEDS CHANGES");
	assert.equal(parsed.findings[0]?.severity, "P1");
});

test("APPROVED with a blocking finding fails closed", () => {
	const parsed = parseReviewVerdict(`\`\`\`json
{"verdict":"APPROVED","findings":[{"severity":"P1","file":"a.ts","issue":"bug","fix":"fix it"}]}
\`\`\``);
	assert.equal(parsed.parsed, false);
	assert.equal(parsed.verdict, "NEEDS CHANGES");
});
