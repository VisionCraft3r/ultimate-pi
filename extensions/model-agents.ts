/**
 * /ModelAgents — assign agent models and 429 fallbacks.
 * Parent sessions load this via extension discovery. Not a child tool.
 *
 * All AGENTS.md edits stay inside the <!-- ultimate-pi:begin --> /
 * <!-- ultimate-pi:end --> marker block — content outside it (the user's own
 * notes) is never touched.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { deriveDefaultChains } from "../lib/quota-fallback.ts";
import {
  AGENT_NAMES,
  type AgentName,
  FALLBACK_PROVIDERS,
  appendEnabledModel,
  cursorScanAvailable,
  formatChain,
  formatNewModels,
  listConfiguredProviders,
  orderModelRefs,
  pickerLabel,
  readAgentModel,
  readEnabledModels,
  resolveFallbackChain,
  scanCursorModels,
  splitModelRef,
  writeAgentFallbackChain,
  writeAgentModel,
  writeFallbackChain,
} from "../lib/model-agents.ts";

function scopedRefs(ctx: ExtensionContext): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const fromSession = (ctx.scopedModels ?? []).map((scoped) => `${scoped.model.provider}/${scoped.model.id}`);
  for (const ref of [...readEnabledModels(), ...fromSession]) {
    const key = ref.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

function availableRefs(ctx: ExtensionContext): string[] {
  const models = [
    ...(ctx.modelRegistry.getAvailable?.() ?? []),
    ...(ctx.modelRegistry.getAll?.() ?? []),
  ];
  return models.map((model) => `${model.provider}/${model.id}`);
}

async function pickModel(ctx: ExtensionContext, title: string): Promise<string | undefined> {
  const ordered = orderModelRefs(scopedRefs(ctx), availableRefs(ctx));
  if (ordered.length === 0) {
    ctx.ui.notify("No models in the registry. Reload after providers are configured.", "warning");
    return undefined;
  }
  const labels = ordered.map((entry) => pickerLabel(entry.ref, entry.scoped));
  const choice = await ctx.ui.select(title, labels);
  if (!choice) return undefined;
  const index = labels.indexOf(choice);
  return index >= 0 ? ordered[index]?.ref : undefined;
}

async function assignAgent(ctx: ExtensionContext): Promise<void> {
  const rows = AGENT_NAMES.map((agent) => {
    const current = readAgentModel(agent) ?? "(unset)";
    return `${agent} — ${current}`;
  });
  const choice = await ctx.ui.select("Assign agent model", rows);
  if (!choice) return;
  const agent = choice.split(" — ")[0] as AgentName;
  if (!AGENT_NAMES.includes(agent)) return;
  const modelRef = await pickModel(ctx, `${agent} model — scoped (*) first`);
  if (!modelRef) return;
  try {
    const { enabledAdded } = writeAgentModel(agent, modelRef);
    const extra = enabledAdded
      ? " Added to enabledModels — confirm under /scoped-models if it does not stick."
      : "";
    ctx.ui.notify(
      `${agent} → ${modelRef}. Respawn that agent to use it.${extra}`,
      "info",
    );
  } catch (err) {
    ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
  }
}

function derivedDefaults(): Record<string, ReturnType<typeof deriveDefaultChains>[string]> {
  return deriveDefaultChains(listConfiguredProviders());
}

async function assignFallback(ctx: ExtensionContext): Promise<void> {
  const rows = FALLBACK_PROVIDERS.map((provider) => {
    const chain = resolveFallbackChain(provider, derivedDefaults());
    return `${provider} — ${formatChain(chain)}`;
  });
  const choice = await ctx.ui.select("Assign 429 fallback (global provider chain)", rows);
  if (!choice) return;
  const provider = choice.split(" — ")[0] ?? "";
  if (!FALLBACK_PROVIDERS.includes(provider as (typeof FALLBACK_PROVIDERS)[number])) return;
  const first = await pickModel(ctx, `${provider} backup 1 — scoped (*) first`);
  if (!first) return;
  const second = await pickModel(ctx, `${provider} backup 2 — scoped (*) first`);
  if (!second) return;
  const chain = [splitModelRef(first), splitModelRef(second)].filter((spec) => spec !== undefined);
  if (chain.length < 2) {
    ctx.ui.notify("Pick provider/id models for both backups.", "warning");
    return;
  }
  writeFallbackChain(provider, chain);
  ctx.ui.notify(`${provider} 429 fallback → ${formatChain(chain)}`, "info");
}

async function assignAgentFallback(ctx: ExtensionContext): Promise<void> {
  const rows = [...AGENT_NAMES, "main"];
  const choice = await ctx.ui.select("Assign per-agent 429 fallback override (\"main\" = top-level orchestrator)", rows);
  if (!choice) return;
  const first = await pickModel(ctx, `${choice} backup 1 — scoped (*) first`);
  if (!first) return;
  const second = await pickModel(ctx, `${choice} backup 2 — scoped (*) first`);
  if (!second) return;
  const chain = [splitModelRef(first), splitModelRef(second)].filter((spec) => spec !== undefined);
  if (chain.length < 2) {
    ctx.ui.notify("Pick provider/id models for both backups.", "warning");
    return;
  }
  writeAgentFallbackChain(choice, chain);
  ctx.ui.notify(`${choice} 429 fallback override → ${formatChain(chain)}`, "info");
}

async function runScan(ctx: ExtensionContext, force: boolean): Promise<void> {
  if (!cursorScanAvailable()) {
    if (force) ctx.ui.notify("Cursor catalog scan skipped — no Cursor credentials or proxy descriptor found.", "info");
    return;
  }
  const result = await scanCursorModels({ force });
  if (result.status === "skipped") return;
  if (result.status === "unavailable") {
    if (force) ctx.ui.notify("Cursor proxy unreachable — model list unchanged.", "warning");
    return;
  }
  if (result.added.length === 0) {
    if (force) ctx.ui.notify(`Cursor catalog is current (${result.total} models).`, "info");
    return;
  }
  ctx.ui.notify(`Cursor: ${result.added.length} new — ${formatNewModels(result.added)}`, "info");
}

export default function modelAgents(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (process.env.PI_SUBAGENT_AGENT || Number(process.env.PI_SUBAGENT_DEPTH ?? "0") >= 1) return;
    if (!cursorScanAvailable()) return;
    try {
      await runScan(ctx, false);
    } catch {
      // proxy or disk trouble must not block startup; next session retries
    }
  });

  pi.registerCommand("ModelAgents", {
    description: "Assign agent models and 429 fallbacks. Scoped models are listed first.",
    async handler(_args, ctx) {
      const action = await ctx.ui.select("ModelAgents", [
        "Assign agent model",
        "Assign fallback (global, per provider)",
        "Assign fallback override (per agent)",
        "Scan now",
      ]);
      if (action === "Assign agent model") await assignAgent(ctx);
      else if (action === "Assign fallback (global, per provider)") await assignFallback(ctx);
      else if (action === "Assign fallback override (per agent)") await assignAgentFallback(ctx);
      else if (action === "Scan now") await runScan(ctx, true);
    },
  });
}
