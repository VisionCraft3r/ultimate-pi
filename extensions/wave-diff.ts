/**
 * Parent-only wave mark and diff. Children start with --no-extensions and
 * this tool is not on any profile, so a worker cannot rewrite the mark.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { diffWave, markWave } from "../lib/wave-diff.ts";
import { traceEvent } from "../lib/trace.ts";

export default function (pi: ExtensionAPI) {
	if (process.env.PI_SUBAGENT_AGENT) return;

	pi.registerTool({
		name: "wave_diff",
		label: "Wave diff",
		description:
			"Record the worktree before a worker wave (action mark) and return the diff since that mark (action diff). Pass the diff to the reviewer as the change range.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("mark"), Type.Literal("diff")]),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = typeof ctx?.cwd === "string" ? ctx.cwd : process.cwd();
			if (params.action === "mark") {
				const mark = markWave(cwd);
				traceEvent("wave-mark", { sha: mark.sha, dirty: mark.porcelain.length });
				return {
					content: [
						{
							type: "text" as const,
							text: `Wave marked at ${mark.sha.slice(0, 12)} (${mark.porcelain.length} dirty path(s)).`,
						},
					],
					details: {},
				};
			}
			const diff = diffWave(cwd);
			traceEvent("wave-diff", { changed: diff.changed.length, created: diff.created.length });
			return { content: [{ type: "text" as const, text: diff.text }], details: {} };
		},
	});
}
