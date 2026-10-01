/**
 * Shared model picker for /agents and /ModelAgents.
 * Lives in lib/ so Pi does not load it as an extension.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { orderModelRefs, pickerLabel, readEnabledModels } from "./model-agents.ts";

export function scopedModelRefs(ctx: ExtensionContext): string[] {
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

export function availableModelRefs(ctx: ExtensionContext): string[] {
  const models = [
    ...(ctx.modelRegistry.getAvailable?.() ?? []),
    ...(ctx.modelRegistry.getAll?.() ?? []),
  ];
  return models.map((model) => `${model.provider}/${model.id}`);
}

export async function pickModel(ctx: ExtensionContext, title: string): Promise<string | undefined> {
  const ordered = orderModelRefs(scopedModelRefs(ctx), availableModelRefs(ctx));
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
