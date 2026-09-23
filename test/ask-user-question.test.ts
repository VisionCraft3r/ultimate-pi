import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import register, { getOtherLabel, normalizeOptions } from "../extensions/ask-user-question.ts";

test("normalizeOptions drops empty labels and defaults value to label", () => {
	assert.deepEqual(
		normalizeOptions([
			{ label: "  Alpha  ", description: " first " },
			{ label: "Beta", value: " beta-id " },
			{ label: "   " },
		]),
		[
			{ label: "Alpha", value: "Alpha", description: "first" },
			{ label: "Beta", value: "beta-id", description: undefined },
		],
	);
});

test("getOtherLabel is Other when that label is unused", () => {
	assert.equal(getOtherLabel([{ label: "Yes", value: "yes" }]), "Other");
});

test("getOtherLabel becomes Other (custom) when Other already exists", () => {
	assert.equal(getOtherLabel([{ label: "Other", value: "other" }]), "Other (custom)");
});

type ToolResult = {
	content: Array<{ type: string; text: string }>;
	details: { answer: unknown; error?: string; cancelled?: boolean; wasCustom?: boolean };
};

type Execute = (
	toolCallId: string,
	params: {
		question: string;
		details?: string;
		options?: Array<{ label: string; value?: string; description?: string }>;
		multiSelect?: boolean;
	},
	signal: AbortSignal,
	onUpdate: () => void,
	ctx: ExtensionContext,
) => Promise<ToolResult>;

function loadExecute(): Execute {
	let execute: Execute | undefined;
	register({
		registerTool(tool: { execute: Execute }) {
			execute = tool.execute;
		},
	} as unknown as ExtensionAPI);
	assert.ok(execute, "ask_user_question must register execute");
	return execute;
}

function fakeCtx(overrides: {
	hasUI: boolean;
	input?: () => Promise<string | undefined>;
	select?: (title?: string, items?: string[]) => Promise<string | undefined>;
}): ExtensionContext {
	return {
		hasUI: overrides.hasUI,
		ui: {
			input: overrides.input ?? (async () => undefined),
			select: overrides.select ?? (async () => undefined),
		},
	} as unknown as ExtensionContext;
}

test("no UI returns an explicit error without selecting", async () => {
	const execute = loadExecute();
	let usedUi = false;
	const result = await execute(
		"call-no-ui",
		{ question: "Pick one?", options: [{ label: "A" }, { label: "B" }] },
		new AbortController().signal,
		() => {},
		fakeCtx({
			hasUI: false,
			select: async () => {
				usedUi = true;
				return "A";
			},
			input: async () => {
				usedUi = true;
				return "silent-default";
			},
		}),
	);
	assert.equal(usedUi, false);
	assert.equal(result.content[0]?.type, "text");
	assert.match(result.content[0]?.text ?? "", /error/i);
	assert.match(result.content[0]?.text ?? "", /ui|headless|interactive/i);
	assert.equal(result.details.answer, null);
	assert.ok(result.details.error);
	assert.equal(result.details.cancelled, true);
});

test("text input returns the typed answer", async () => {
	const execute = loadExecute();
	const result = await execute(
		"call-text",
		{ question: "Name?", details: "Your name" },
		new AbortController().signal,
		() => {},
		fakeCtx({
			hasUI: true,
			input: async () => "  Ada  ",
			select: async () => {
				throw new Error("select must not run in text mode");
			},
		}),
	);
	assert.deepEqual(result.content, [{ type: "text", text: "User answered: Ada" }]);
	assert.equal(result.details.answer, "Ada");
	assert.equal(result.details.wasCustom, true);
	assert.notEqual(result.details.answer, null);
});

test("single-select returns the chosen option value", async () => {
	const execute = loadExecute();
	const result = await execute(
		"call-single",
		{
			question: "Pick a color?",
			options: [
				{ label: "Red", value: "red" },
				{ label: "Blue", value: "blue" },
			],
		},
		new AbortController().signal,
		() => {},
		fakeCtx({
			hasUI: true,
			select: async () => "Blue",
			input: async () => {
				throw new Error("input must not run for a regular single-select choice");
			},
		}),
	);
	assert.deepEqual(result.content, [{ type: "text", text: "User selected: Blue" }]);
	assert.equal(result.details.answer, "blue");
	assert.notEqual(result.details.answer, "Blue");
	assert.notEqual(result.details.wasCustom, true);
	assert.notEqual(result.details.cancelled, true);
});

test("single-select Other opens input and returns a trimmed custom answer", async () => {
	const execute = loadExecute();
	const options = [
		{ label: "Red", value: "red" },
		{ label: "Other", value: "other" },
	];
	const otherLabel = getOtherLabel(normalizeOptions(options));
	assert.equal(otherLabel, "Other (custom)");

	let sawInput = false;
	const result = await execute(
		"call-single-other",
		{ question: "Pick a color?", details: "Favorite", options },
		new AbortController().signal,
		() => {},
		fakeCtx({
			hasUI: true,
			select: async (_title?: string, items?: string[]) => {
				assert.ok(items?.includes("Other"));
				assert.ok(items?.includes(otherLabel));
				return otherLabel;
			},
			input: async () => {
				sawInput = true;
				return "  teal  ";
			},
		}),
	);
	assert.equal(sawInput, true);
	assert.deepEqual(result.content, [{ type: "text", text: "User wrote: teal" }]);
	assert.equal(result.details.answer, "teal");
	assert.equal(result.details.wasCustom, true);
	assert.notEqual(result.details.cancelled, true);
});

test("multi-select toggles two options then Done", async () => {
	const execute = loadExecute();
	let selectCalls = 0;
	const result = await execute(
		"call-multi",
		{
			question: "Pick colors?",
			options: [
				{ label: "Red", value: "red" },
				{ label: "Blue", value: "blue" },
				{ label: "Green", value: "green" },
			],
			multiSelect: true,
		},
		new AbortController().signal,
		() => {},
		fakeCtx({
			hasUI: true,
			select: async (_title?: string, items?: string[]) => {
				selectCalls += 1;
				if (selectCalls === 1) {
					assert.ok(items?.includes("[ ] Red"));
					return "[ ] Red";
				}
				if (selectCalls === 2) {
					assert.ok(items?.includes("[x] Red"));
					assert.ok(items?.includes("[ ] Blue"));
					return "[ ] Blue";
				}
				assert.ok(items?.includes("Done"));
				return "Done";
			},
			input: async () => {
				throw new Error("input must not run when toggling ordinary multi-select options");
			},
		}),
	);
	assert.equal(selectCalls, 3);
	assert.deepEqual(result.content, [{ type: "text", text: "User selected: red, blue" }]);
	assert.deepEqual(result.details.answer, ["red", "blue"]);
	assert.equal(result.details.wasCustom, false);
	assert.notEqual(result.details.cancelled, true);
});

test("cancelled UI returns cancelled details with no answer", async () => {
	const execute = loadExecute();
	const result = await execute(
		"call-cancel",
		{
			question: "Pick one?",
			options: [
				{ label: "A", value: "a" },
				{ label: "B", value: "b" },
			],
		},
		new AbortController().signal,
		() => {},
		fakeCtx({
			hasUI: true,
			select: async () => undefined,
			input: async () => {
				throw new Error("input must not run when select is cancelled");
			},
		}),
	);
	assert.equal(result.content[0]?.type, "text");
	assert.match(result.content[0]?.text ?? "", /cancel/i);
	assert.equal(result.details.answer, null);
	assert.notEqual(result.details.answer, "a");
	assert.notEqual(result.details.answer, "b");
	assert.notEqual(result.details.answer, "A");
	assert.equal(result.details.cancelled, true);
	assert.notEqual(result.details.wasCustom, true);
});

test("multi-select Other merges a trimmed custom answer with an ordinary value", async () => {
	const execute = loadExecute();
	const options = [
		{ label: "Red", value: "red" },
		{ label: "Blue", value: "blue" },
	];
	const otherLabel = getOtherLabel(normalizeOptions(options));
	assert.equal(otherLabel, "Other");

	let selectCalls = 0;
	let inputCalls = 0;
	const result = await execute(
		"call-multi-other",
		{ question: "Pick colors?", options, multiSelect: true },
		new AbortController().signal,
		() => {},
		fakeCtx({
			hasUI: true,
			select: async (_title?: string, items?: string[]) => {
				selectCalls += 1;
				if (selectCalls === 1) {
					assert.ok(items?.includes("[ ] Red"));
					return "[ ] Red";
				}
				if (selectCalls === 2 || selectCalls === 3) {
					assert.ok(items?.includes(otherLabel));
					return otherLabel;
				}
				return "Done";
			},
			input: async () => {
				inputCalls += 1;
				if (inputCalls === 1) return undefined;
				return "  teal  ";
			},
		}),
	);
	assert.equal(selectCalls, 4);
	assert.equal(inputCalls, 2);
	assert.deepEqual(result.content, [{ type: "text", text: "User selected: red, teal" }]);
	assert.deepEqual(result.details.answer, ["red", "teal"]);
	assert.ok(Array.isArray(result.details.answer) && !result.details.answer.includes("Other"));
	assert.equal(result.details.wasCustom, true);
	assert.notEqual(result.details.cancelled, true);
});
