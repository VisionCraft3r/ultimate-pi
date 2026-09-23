/**
 * Planner spec-ready handoff. Keep this file outside extensions/*.ts — Pi
 * auto-loads every top-level .ts there as an extension factory.
 *
 * Child writes `${PI_SUBAGENT_SESSION}.ask`; the parent watcher already
 * delivers that as a subagent_question steer. Do not fork the spawn engine.
 */

import { existsSync, writeFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const PARK_TEXT =
  /parked for review|decision-complete|## Open Questions|no workers (were )?dispatched/i;
const PLAN_PATH = /\.pi\/plans\/[^\s`"'<>]+/;
const HANDOFF_TOOLS = new Set(["ask_question", "handoff_spec"]);

let fired = false;

export function isPlannerChild(): boolean {
  return (process.env.PI_SUBAGENT_AGENT ?? "") === "planner";
}

function sessionFile(): string | undefined {
  const path = process.env.PI_SUBAGENT_SESSION;
  return path && path.length > 0 ? path : undefined;
}

function askPath(file: string): string {
  return `${file}.ask`;
}

export function writeAskSidecar(question: string): boolean {
  const file = sessionFile();
  if (!file) return false;
  const sidecar = askPath(file);
  if (existsSync(sidecar)) return false;
  writeFileSync(
    sidecar,
    JSON.stringify({
      name: process.env.PI_SUBAGENT_NAME ?? "planner",
      agent: process.env.PI_SUBAGENT_AGENT ?? "planner",
      question,
    }),
  );
  return true;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type: string; text: string } =>
        Boolean(part) && part.type === "text" && typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

function toolNames(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const names: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as { type?: string; name?: string };
    if ((p.type === "toolCall" || p.type === "toolUse") && typeof p.name === "string") {
      names.push(p.name);
    }
  }
  return names;
}

function lastAssistant(ctx: ExtensionContext): { text: string; tools: string[] } | undefined {
  const entries = ctx.sessionManager?.getEntries?.() ?? [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as { type?: string; message?: { role?: string; content?: unknown } };
    const msg = entry?.message ?? entry;
    if (!msg || typeof msg !== "object") continue;
    if ((msg as { role?: string }).role !== "assistant") continue;
    const content = (msg as { content?: unknown }).content;
    return { text: contentText(content), tools: toolNames(content) };
  }
  return undefined;
}

export function isSilentPark(text: string, tools: string[]): boolean {
  if (tools.some((name) => HANDOFF_TOOLS.has(name))) return false;
  if (!PLAN_PATH.test(text)) return false;
  return PARK_TEXT.test(text);
}

export function synthesizeHandoffQuestion(text: string): string {
  const path = text.match(PLAN_PATH)?.[0] ?? ".pi/plans/<unknown>.md";
  const verdictLine =
    text.match(/\*\*Verdict:\*\*\s*(.+)/i)?.[1]?.trim() ??
    text.match(/Verdict:\s*(.+)/i)?.[1]?.trim() ??
    "see spec";
  return [
    `Spec ready for review at \`${path}\`.`,
    `Verdict: ${verdictLine.slice(0, 240)}`,
    "Approve this spec or send revision notes.",
    "After you approve, fan out workers from the plan leaves (cap 3). Do not tell this planner to spawn workers.",
    "This pane does not load a plan-review UI; a park line is not a handoff.",
  ].join("\n");
}

export function formatHandoffQuestion(args: {
  path: string;
  verdict: string;
  briefs?: string;
}): string {
  const lines = [
    `Spec ready for review at \`${args.path}\`.`,
    `Verdict: ${args.verdict}`,
    "Approve this spec or send revision notes.",
    "After you approve, fan out workers from the plan leaves (cap 3). Do not tell this planner to spawn workers.",
  ];
  if (args.briefs?.trim()) lines.push("", args.briefs.trim());
  return lines.join("\n");
}

export function installPlannerHandoff(pi: ExtensionAPI): void {
  if (isPlannerChild()) {
    pi.registerTool({
      name: "handoff_spec",
      label: "handoff_spec",
      description:
        "Required last call when the spec is on disk. Sends the spec-ready package to the parent orchestrator and waits. Pane markdown is not a handoff. Do not silently park in this pane.",
      promptSnippet:
        "Call handoff_spec once the spec is written — that is the only spec-ready handoff to the parent.",
      promptGuidelines: [
        "Last action of the park turn must be handoff_spec, not a text-only park line.",
        "Product questions still use ask_question, one at a time.",
      ],
      parameters: Type.Object({
        path: Type.String({ description: "Spec path, e.g. .pi/plans/slug.md" }),
        verdict: Type.String({
          description: "approve / revise-then-implement, plus a one-line reason",
        }),
        briefs: Type.Optional(
          Type.String({
            description:
              "Dispatch package after human approval: worker count, concurrency cap 3, each brief self-contained",
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const file = sessionFile();
        if (!file) {
          return {
            content: [
              {
                type: "text" as const,
                text: "handoff_spec is only available in planner subagent sessions (PI_SUBAGENT_SESSION missing).",
              },
            ],
            details: { error: "not-subagent" as string | undefined, question: undefined as string | undefined },
          };
        }
        const question = formatHandoffQuestion(params);
        writeAskSidecar(question);
        fired = true;
        return {
          content: [
            {
              type: "text" as const,
              text:
                "Spec handoff sent to the orchestrator. Stop here and wait — do not continue or assume approval. Their reply will arrive as your next message.",
            },
          ],
          details: { error: undefined as string | undefined, question },
        };
      },
    });
  }

  pi.on("agent_settled", (_event, ctx) => {
    if (!isPlannerChild() || fired) return;
    const file = sessionFile();
    if (!file || existsSync(askPath(file))) return;
    const last = lastAssistant(ctx);
    if (!last || !isSilentPark(last.text, last.tools)) return;
    fired = true;
    writeAskSidecar(synthesizeHandoffQuestion(last.text));
  });
}
