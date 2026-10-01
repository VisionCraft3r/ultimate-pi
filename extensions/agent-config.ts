/**
 * /agents — list agent profiles and change model or thinking level.
 * Applies on the next spawn. A running pane keeps the model it started with.
 * Parent sessions only. Not a child tool.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { pickModel } from "../lib/model-picker.ts";
import {
  THINKING_LEVELS,
  type AgentProfile,
  listAgentProfiles,
  writeAgentModel,
  writeAgentThinking,
} from "../lib/model-agents.ts";

const USAGE =
  "Usage: /agents | /agents list | /agents <name> model <provider/id> | /agents <name> thinking <level>";

function isSubagent(): boolean {
  return Boolean(process.env.PI_SUBAGENT_AGENT) || Number(process.env.PI_SUBAGENT_DEPTH ?? "0") >= 1;
}

function formatRow(profile: AgentProfile): string {
  return `${profile.name} — ${profile.model ?? "(unset)"} · thinking ${profile.thinking ?? "(unset)"}`;
}

function profileNamed(name: string): AgentProfile | undefined {
  return listAgentProfiles().find((profile) => profile.name === name);
}

function findListedModel(ctx: ExtensionContext, ref: string): { reasoning?: boolean } | undefined {
  const slash = ref.indexOf("/");
  if (slash <= 0) return undefined;
  const provider = ref.slice(0, slash);
  const id = ref.slice(slash + 1);
  const models = [
    ...(ctx.modelRegistry.getAvailable?.() ?? []),
    ...(ctx.modelRegistry.getAll?.() ?? []),
  ];
  return models.find((model) => model.provider === provider && model.id === id);
}

function assignmentWarnings(ctx: ExtensionContext, modelRef: string | undefined, thinking: string | undefined): string[] {
  const warnings: string[] = [];
  if (!modelRef) return warnings;
  const listed = findListedModel(ctx, modelRef);
  if (!listed) {
    warnings.push(`${modelRef} is not in the model registry. Saved anyway.`);
    return warnings;
  }
  if (thinking && thinking !== "off" && listed.reasoning === false) {
    warnings.push(`${modelRef} does not list reasoning. Thinking "${thinking}" was saved anyway.`);
  }
  return warnings;
}

function savedNote(profile: AgentProfile): string {
  const model = profile.model ?? "(unset)";
  const thinking = profile.thinking ?? "(unset)";
  return `${profile.name} now runs ${model} (thinking ${thinking}). Applies to the next ${profile.name} spawn; running agents keep their current model.`;
}

function applyChange(
  ctx: ExtensionContext,
  name: string,
  change: { model?: string; thinking?: string },
): void {
  if (!profileNamed(name)) throw new Error(`no agent profile agents/${name}.md`);
  if (change.model) writeAgentModel(name, change.model);
  if (change.thinking) writeAgentThinking(name, change.thinking);
  const profile = profileNamed(name);
  if (!profile) throw new Error(`no agent profile agents/${name}.md`);
  const warnings = assignmentWarnings(ctx, profile.model, profile.thinking);
  const extra = warnings.length ? ` ${warnings.join(" ")}` : "";
  ctx.ui.notify(`${savedNote(profile)}${extra}`, warnings.length ? "warning" : "info");
}

async function changeAgent(ctx: ExtensionContext, name: string, which: "model" | "thinking" | "both"): Promise<void> {
  const change: { model?: string; thinking?: string } = {};
  if (which === "model" || which === "both") {
    const model = await pickModel(ctx, `${name} model — scoped (*) first`);
    if (!model) return;
    change.model = model;
  }
  if (which === "thinking" || which === "both") {
    const level = await ctx.ui.select(`${name} thinking`, [...THINKING_LEVELS]);
    if (!level) return;
    change.thinking = level;
  }
  applyChange(ctx, name, change);
}

async function interactive(ctx: ExtensionContext): Promise<void> {
  const profiles = listAgentProfiles();
  if (profiles.length === 0) {
    ctx.ui.notify("No agent profiles in agents/.", "warning");
    return;
  }
  const rows = profiles.map(formatRow);
  const choice = await ctx.ui.select("Agents", rows);
  if (!choice) return;
  const name = choice.split(" — ")[0] ?? "";
  if (!profileNamed(name)) return;
  const action = await ctx.ui.select(name, ["Change model", "Change thinking", "Change both"]);
  if (action === "Change model") await changeAgent(ctx, name, "model");
  else if (action === "Change thinking") await changeAgent(ctx, name, "thinking");
  else if (action === "Change both") await changeAgent(ctx, name, "both");
}

export default function agentConfig(pi: ExtensionAPI) {
  pi.registerCommand("agents", {
    description: "List agents and change the model or thinking level. Applies on the next spawn.",
    async handler(args, ctx) {
      if (isSubagent()) {
        ctx.ui.notify("/agents is for the main session.", "warning");
        return;
      }
      const tokens = args.trim().split(/\s+/).filter(Boolean);
      try {
        if (tokens.length === 0) {
          await interactive(ctx);
          return;
        }
        if (tokens[0] === "list" && tokens.length === 1) {
          const rows = listAgentProfiles().map(formatRow);
          ctx.ui.notify(rows.length ? rows.join("\n") : "No agent profiles in agents/.", "info");
          return;
        }
        if (tokens.length >= 3 && (tokens[1] === "model" || tokens[1] === "thinking")) {
          const name = tokens[0] ?? "";
          const value = tokens.slice(2).join(" ");
          if (tokens[1] === "model") applyChange(ctx, name, { model: value });
          else applyChange(ctx, name, { thinking: value });
          return;
        }
        ctx.ui.notify(USAGE, "warning");
      } catch (err) {
        ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
      }
    },
  });
}
