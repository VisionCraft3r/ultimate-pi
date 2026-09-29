import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PersonaFrontmatter } from "./personas.ts";

export type ModelRef = { provider: string; id: string };

export function splitModelRef(ref: string): ModelRef | undefined {
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) return undefined;
  return { provider: ref.slice(0, slash), id: ref.slice(slash + 1) };
}

export function modelRefKey(ref: string): string {
  return ref.trim().toLowerCase();
}

export function readEnabledModels(agentDir: string): string[] {
  try {
    const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")) as {
      enabledModels?: unknown;
    };
    if (!Array.isArray(settings.enabledModels)) return [];
    return settings.enabledModels.filter((entry): entry is string => typeof entry === "string" && entry.includes("/"));
  } catch {
    return [];
  }
}

export function writeEnabledModels(agentDir: string, models: readonly string[]): string[] {
  const path = join(agentDir, "settings.json");
  const settings = JSON.parse(readFileSync(path, "utf8")) as { enabledModels?: unknown };
  const next = [...new Set(models.map((model) => model.trim()).filter((model) => model.includes("/")))];
  settings.enabledModels = next;
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  return next;
}

export function isInScope(model: string, scoped: readonly string[]): boolean {
  if (!model.trim()) return false;
  const key = modelRefKey(model);
  return scoped.some((entry) => modelRefKey(entry) === key);
}

export function assertInScope(model: string, scoped: readonly string[]): void {
  if (!model.trim()) return;
  if (scoped.length === 0) {
    throw new Error(`scoped model list is empty; add ${model} under Ultimate PI setup before hiring this persona`);
  }
  if (!isInScope(model, scoped)) {
    throw new Error(`${model} is outside the scoped model list`);
  }
}

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

export function isThinkingLevel(value: string): boolean {
  return (THINKING_LEVELS as readonly string[]).includes(value);
}

export function replaceThinkingLine(markdown: string, level: string): string | undefined {
  const end = markdown.indexOf("\n---", 3);
  if (!markdown.startsWith("---") || end < 0) return undefined;
  const head = markdown.slice(0, end);
  const rest = markdown.slice(end);
  if (/^thinking:\s*\S+/m.test(head)) {
    return head.replace(/^thinking:\s*.+$/m, `thinking: ${level}`) + rest;
  }
  const model = head.match(/^model:\s*\S+/m);
  if (model?.index !== undefined) {
    const insertAt = model.index + model[0].length;
    return `${head.slice(0, insertAt)}\nthinking: ${level}${head.slice(insertAt)}${rest}`;
  }
  return `${head}\nthinking: ${level}${rest}`;
}

export function writePersonaThinking(agentDir: string, persona: string, level: string): void {
  if (!isThinkingLevel(level)) throw new Error(`thinking level must be one of ${THINKING_LEVELS.join(", ")}`);
  const path = join(agentDir, "agents", `${persona}.md`);
  const text = readFileSync(path, "utf8");
  const next = replaceThinkingLine(text, level);
  if (!next) throw new Error(`no frontmatter in agents/${persona}.md`);
  writeFileSync(path, next);
}

export function replaceModelLine(markdown: string, modelRef: string): string | undefined {
  const end = markdown.indexOf("\n---", 3);
  if (!markdown.startsWith("---") || end < 0) return undefined;
  const head = markdown.slice(0, end);
  if (!/^model:\s*\S+/m.test(head)) return undefined;
  return head.replace(/^model:\s*\S+/m, `model: ${modelRef}`) + markdown.slice(end);
}

export function writePersonaModel(agentDir: string, persona: string, modelRef: string, scoped: readonly string[]): void {
  assertInScope(modelRef, scoped);
  const path = join(agentDir, "agents", `${persona}.md`);
  const text = readFileSync(path, "utf8");
  const next = replaceModelLine(text, modelRef);
  if (!next) throw new Error(`no model: line in agents/${persona}.md`);
  writeFileSync(path, next);
}

export type FallbackFile = {
  fallbacks?: Record<string, ModelRef[]>;
  agentFallbacks?: Record<string, ModelRef[]>;
};

export function readFallbacks(agentDir: string): FallbackFile {
  try {
    const raw = JSON.parse(readFileSync(join(agentDir, "model-agents.json"), "utf8")) as FallbackFile;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function writeProviderFallback(
  agentDir: string,
  provider: string,
  chain: readonly string[],
  scoped: readonly string[],
): FallbackFile {
  for (const ref of chain) assertInScope(ref, scoped);
  const specs = chain.map((ref) => {
    const spec = splitModelRef(ref);
    if (!spec) throw new Error(`fallback model must be provider/id: ${ref}`);
    return spec;
  });
  const current = readFallbacks(agentDir);
  const next: FallbackFile = {
    ...current,
    fallbacks: { ...(current.fallbacks ?? {}), [provider]: specs },
  };
  writeFileSync(join(agentDir, "model-agents.json"), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function personaModelError(persona: PersonaFrontmatter, scoped: readonly string[]): string | undefined {
  if (persona.name === "orchestrator" || !persona.model || persona.model.includes("{{")) return undefined;
  try {
    assertInScope(persona.model, scoped);
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
