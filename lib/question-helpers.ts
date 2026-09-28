/**
 * Option helpers for ask_user_question.
 * Aligns with @earendil-works/pi-tui SelectItem and Pi examples that always
 * append a custom-entry choice (here: Other, not "Type something.").
 */

export type QuestionMode = "text" | "single" | "multi";

export type RawOption = {
	label?: string;
	value?: string;
	description?: string;
};

export type AskOption = {
	label: string;
	value: string;
	description?: string;
};

/** Trim fields, drop empty labels, default value to label. */
export function normalizeOptions(options?: RawOption[] | null): AskOption[] {
	const out: AskOption[] = [];
	for (const option of options ?? []) {
		const label = option.label?.trim() ?? "";
		if (!label) continue;
		out.push({
			label,
			value: option.value?.trim() || label,
			description: option.description?.trim() || undefined,
		});
	}
	return out;
}

/** Collision-safe label for the always-available custom entry. */
export function getOtherLabel(options: AskOption[]): string {
	const taken = options.some((option) => option.label.toLowerCase() === "other");
	return taken ? "Other (custom)" : "Other";
}

/** Append the custom Other entry without mutating `options`. */
export function optionsWithOther(options: AskOption[]): AskOption[] {
	const label = getOtherLabel(options);
	return [...options, { label, value: label, description: undefined }];
}

export function normalizeMode(value: unknown): QuestionMode {
	const raw = String(value ?? "")
		.trim()
		.toLowerCase()
		.replace(/[_-]/g, "");
	if (raw === "text" || raw === "input" || raw === "freetext" || raw === "freeform") return "text";
	if (raw === "multi" || raw === "multiselect" || raw === "multiple") return "multi";
	return "single";
}

/** Text prompts have no list; single/multi always include Other. */
export function promptOptions(mode: QuestionMode, options?: RawOption[] | null): AskOption[] {
	if (mode === "text") return [];
	return optionsWithOther(normalizeOptions(options));
}

/** Question text parked in a subagent `.ask` sidecar for the parent session. */
export function formatSidecarQuestion(input: {
	question: string;
	details?: string;
	options?: Array<{ label: string; description?: string }>;
	multiSelect?: boolean;
}): string {
	const lines = [input.question.trim()];
	const details = input.details?.trim();
	if (details) lines.push("", details);
	const options = (input.options ?? []).filter((option) => option.label.trim());
	if (options.length > 0) {
		lines.push("", input.multiSelect ? "Select any:" : "Options:");
		for (const option of options) {
			const hint = option.description?.trim() ? ` — ${option.description.trim()}` : "";
			lines.push(`- ${option.label.trim()}${hint}`);
		}
		lines.push("- Other");
	}
	return lines.join("\n");
}
