/**
 * How a finished implementation is checked. The code reviewer is one option,
 * not the default. Workers already run tests. A scout re-reads logic. The
 * browser agent operates a UI. A reviewer is only for review-shaped risk.
 */

export type Verification = "tests" | "scout" | "browser" | "reviewer";

export const VERIFICATION_CONFIDENCE = 0.7;

const VERIFY_REVIEW =
	/\b(security|payment|billing|migration|data loss|exploit|privilege)\b|\breview (the|this) (diff|change|code)\b/i;
const VERIFY_BROWSER =
	/\b(browser|click[\s-]*through|simulator|screen|button|blank page|white page|when i click)\b/i;
const VERIFY_SCOUT =
	/\b(core logic|invariant|algorithm|calculation)\b|\b(make sure|verify|double-check) the (logic|math|calculation|invariant)\b/i;

export function verificationForTier(tier: string): Verification | undefined {
	if (tier === "tier_5_review") return "reviewer";
	if (tier === "tier_4_qa") return "browser";
	if (tier === "tier_0") return "tests";
	return undefined;
}

/** Fallback when JEV did not return a confident verification choice. */
export function classifyVerification(prompt: string, tier: string): Verification {
	const fixed = verificationForTier(tier);
	if (fixed) return fixed;
	if (VERIFY_REVIEW.test(prompt)) return "reviewer";
	if (VERIFY_BROWSER.test(prompt)) return "browser";
	if (VERIFY_SCOUT.test(prompt)) return "scout";
	return "tests";
}

/**
 * Live JEV choice for tier_1..tier_3. A missing or low-confidence answer
 * stays on tests, so a weak call cannot invent a reviewer.
 */
export function verificationFromChoice(
	tier: string,
	choice: string | undefined,
	confidence: number | undefined,
): Verification {
	const fixed = verificationForTier(tier);
	if (fixed) return fixed;
	if (choice !== "tests" && choice !== "scout" && choice !== "browser" && choice !== "reviewer") {
		return "tests";
	}
	if (choice === "tests") return "tests";
	if (confidence === undefined || confidence < VERIFICATION_CONFIDENCE) return "tests";
	return choice;
}

export function formatVerification(mode: Verification): string {
	return `Verification: ${mode}.`;
}
