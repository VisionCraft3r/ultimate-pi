/**
 * ask_user_question — prompt via documented ctx.ui dialogs (not a custom TUI).
 * Text: ui.input; single: ui.select; multi: toggle loop + Done; Other always opens ui.input.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fileURLToPath } from "node:url";
import { writeAskSidecar } from "../lib/planner-handoff.ts";
import { formatSidecarQuestion, getOtherLabel, normalizeOptions, type AskOption } from "../lib/question-helpers.ts";

export { getOtherLabel, normalizeOptions };

const OptionSchema = Type.Object({
	label: Type.String({ description: "Display label" }),
	value: Type.Optional(Type.String({ description: "Returned value; defaults to label" })),
	description: Type.Optional(Type.String({ description: "Optional hint" })),
});

const ParamSchema = Type.Object({
	question: Type.String({ description: "Question to ask the user" }),
	details: Type.Optional(Type.String({ description: "Extra context or input placeholder" })),
	options: Type.Optional(Type.Array(OptionSchema, { description: "Choices; omit for free-text" })),
	multiSelect: Type.Optional(Type.Boolean({ description: "Toggle many answers, then Done" })),
});

type QuestionParams = {
	question: string;
	details?: string;
	options?: Array<{ label: string; value?: string; description?: string }>;
	multiSelect?: boolean;
};

type Details = {
	question: string;
	prompt?: string;
	multiSelect: boolean;
	options: string[];
	answer: string | string[] | null;
	cancelled?: boolean;
	wasCustom?: boolean;
	error?: string;
};

const DONE = "Done";
const SUBAGENT_WAIT_TEXT = "Question sent to the orchestrator. Stop here and wait — do not continue working or assume an answer. Their reply will arrive as your next message.";

function reply(text: string, details: Details) {
	return { content: [{ type: "text" as const, text }], details };
}

function cancelled(base: Omit<Details, "answer">, reason: string) {
	return reply(reason, { ...base, answer: null, cancelled: true });
}

async function customValue(ctx: ExtensionContext, question: string, placeholder: string) {
	const typed = await ctx.ui.input(question, placeholder);
	return typed?.trim() || "";
}

async function askSingle(
	ctx: ExtensionContext,
	title: string,
	question: string,
	placeholder: string,
	options: AskOption[],
	base: Omit<Details, "answer">,
) {
	const other = getOtherLabel(options);
	const choice = await ctx.ui.select(title, [...options.map((o) => o.label), other]);
	if (!choice) return cancelled(base, "Error: user cancelled the question.");
	if (choice === other) {
		const typed = await customValue(ctx, question, placeholder);
		if (!typed) return cancelled(base, "Error: user cancelled the custom answer.");
		return reply(`User wrote: ${typed}`, { ...base, answer: typed, wasCustom: true });
	}
	const hit = options.find((o) => o.label === choice);
	const answer = hit?.value ?? choice;
	return reply(`User selected: ${choice}`, { ...base, answer });
}

async function askMulti(
	ctx: ExtensionContext,
	title: string,
	question: string,
	placeholder: string,
	options: AskOption[],
	base: Omit<Details, "answer">,
) {
	const other = getOtherLabel(options);
	const selected = new Set<string>();
	for (;;) {
		const items: Array<{ display: string; action: "toggle" | "other" | "done"; value?: string }> = [
			...options.map((o) => ({
				display: `${selected.has(o.value) ? "[x]" : "[ ]"} ${o.label}`,
				action: "toggle" as const,
				value: o.value,
			})),
		];
		for (const value of selected) {
			if (!options.some((o) => o.value === value)) {
				items.push({ display: `[x] ${value}`, action: "toggle", value });
			}
		}
		items.push({ display: other, action: "other" }, { display: DONE, action: "done" });
		const choice = await ctx.ui.select(title, items.map((item) => item.display));
		if (!choice) return cancelled(base, "Error: user cancelled the question.");
		const hit = items.find((item) => item.display === choice);
		if (!hit || hit.action === "done") break;
		if (hit.action === "other") {
			const typed = await customValue(ctx, question, placeholder);
			if (typed) selected.add(typed);
			continue;
		}
		if (hit.value !== undefined) {
			if (selected.has(hit.value)) selected.delete(hit.value);
			else selected.add(hit.value);
		}
	}
	const answer = [...selected];
	const text = answer.length ? `User selected: ${answer.join(", ")}` : "User selected: (none)";
	return reply(text, { ...base, answer, wasCustom: answer.some((v) => !options.some((o) => o.value === v)) });
}

const THIS_FILE = fileURLToPath(import.meta.url);

function registerForSubagents(name: string, extensionPath: string): void {
	const register = (globalThis as { __pi_interactive_subagents?: { registerToolExtension?: (name: string, path: string) => void } }).__pi_interactive_subagents?.registerToolExtension;
	if (typeof register !== "function") return;
	try {
		register(name, extensionPath);
	} catch {
		// already bound to this path
	}
}

export default function askUserQuestion(pi: ExtensionAPI) {
	registerForSubagents("ask_user_question", THIS_FILE);
	pi.on("session_start", () => {
		registerForSubagents("ask_user_question", THIS_FILE);
	});
	pi.registerTool({
		name: "ask_user_question",
		label: "Ask User",
		description:
			"Ask the user a question. Omit options for free text; otherwise single-select, or multi-select when multiSelect is true. An Other choice always allows a custom value.",
		parameters: ParamSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params: QuestionParams, _signal, _onUpdate, ctx: ExtensionContext) {
			const options = normalizeOptions(params.options);
			const multiSelect = Boolean(params.multiSelect);
			const base = {
				question: params.question,
				prompt: params.details,
				multiSelect,
				options: options.map((o) => o.label),
			};
			if (process.env.PI_SUBAGENT_SESSION?.trim()) {
				const parked = writeAskSidecar(formatSidecarQuestion({
					question: params.question,
					details: params.details,
					options,
					multiSelect,
				}));
				if (!parked) {
					return reply(
						"A question is already waiting for the orchestrator. Stop and wait for the reply.",
						{ ...base, answer: null },
					);
				}
				return reply(SUBAGENT_WAIT_TEXT, { ...base, answer: null });
			}
			if (!ctx.hasUI) {
				return reply(
					"Error: cannot ask the user without an interactive UI (headless or non-interactive mode).",
					{ ...base, answer: null, cancelled: true, error: "no_ui" },
				);
			}
			const title = params.details ? `${params.question}\n${params.details}` : params.question;
			const placeholder = params.details?.trim() || "Your answer";
			if (multiSelect) return askMulti(ctx, title, params.question, placeholder, options, base);
			if (options.length === 0) {
				const typed = await customValue(ctx, params.question, placeholder);
				if (!typed) return cancelled(base, "Error: user cancelled the question.");
				return reply(`User answered: ${typed}`, { ...base, answer: typed, wasCustom: true });
			}
			return askSingle(ctx, title, params.question, placeholder, options, base);
		},
	});
}
