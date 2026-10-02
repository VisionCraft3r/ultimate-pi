/**
 * Cursor catalog scan and /ModelAgents persistence.
 * Keep this file outside extensions/*.ts — Pi auto-loads every top-level
 * .ts there as an extension factory.
 *
 * Daily scan hits the local Cursor proxy (POST refresh, then GET) and writes
 * the same model array pi-cursor stores in cursor-model-cache.json.
 * The scan only runs when Cursor credentials AND a cursor-proxy.json file
 * both exist. A descriptor whose pid is not running is treated as no proxy.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "./agent-dir.ts";

function inAgent(name: string): string {
  return join(getAgentDir(), name);
}

/** Marker comments the AGENTS.md table edits must stay inside. */
export const AGENTS_MD_BEGIN_MARKER = "<!-- ultimate-pi:begin -->";
export const AGENTS_MD_END_MARKER = "<!-- ultimate-pi:end -->";

export const AGENT_NAMES = ["scout", "worker", "planner", "researcher", "qa_tester", "reviewer"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export type AgentProfile = {
  name: string;
  model?: string;
  thinking?: string;
  description?: string;
};

const AGENT_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Default provider ordering used only when no chain is configured. Caller supplies real defaults via deriveDefaultChains(). */
export const FALLBACK_PROVIDERS = ["anthropic", "openai-codex", "cursor", "openai", "openrouter", "deepseek"] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ModelRef = { provider: string; id: string };
export type ScanResult =
  | { status: "skipped" }
  | { status: "unavailable" }
  | { status: "ok"; added: string[]; total: number; missing: string[] };

type ScanState = { lastSuccess?: string; ids?: string[] };
type AssignmentsFile = {
  fallbacks?: Record<string, ModelRef[]>;
  /** Per-agent override, keyed by agent name or "main" for the top-level orchestrator. */
  agentFallbacks?: Record<string, ModelRef[]>;
};

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

function readJson(path: string): JsonValue | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as JsonValue;
  } catch {
    return undefined;
  }
}

function modelIds(models: unknown): string[] {
  if (!Array.isArray(models)) return [];
  const ids: string[] = [];
  for (const entry of models) {
    if (!entry || typeof entry !== "object") continue;
    const id = (entry as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) ids.push(id);
  }
  return ids;
}

function readScanState(): ScanState {
  const raw = readJson(inAgent("cursor-model-scan.json"));
  if (!raw || typeof raw !== "object") return {};
  const state = raw as ScanState;
  return {
    lastSuccess: typeof state.lastSuccess === "string" ? state.lastSuccess : undefined,
    ids: Array.isArray(state.ids) ? state.ids.filter((id) => typeof id === "string") : undefined,
  };
}

export function scanDue(now = Date.now()): boolean {
  const last = readScanState().lastSuccess;
  if (!last) return true;
  const at = Date.parse(last);
  if (!Number.isFinite(at)) return true;
  return now - at >= DAY_MS;
}

/** True when `pid` is a live process. EPERM still means the process exists. */
export function pidIsRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function proxyPort(): number | undefined {
  const raw = readJson(inAgent("cursor-proxy.json"));
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as { port?: unknown; pid?: unknown };
  const port = record.port;
  if (typeof port !== "number" || port <= 0) return undefined;
  // A descriptor left behind by a dead proxy must not be dialed.
  if (typeof record.pid === "number" && !pidIsRunning(record.pid)) return undefined;
  return port;
}

/** Cursor `provider/id` refs whose id is absent from the catalog. Other providers are ignored. */
export function missingCursorRefs(catalogIds: readonly string[], refs: readonly string[]): string[] {
  const known = new Set(catalogIds.map((id) => id.toLowerCase()));
  const missing: string[] = [];
  for (const ref of refs) {
    if (!ref.toLowerCase().startsWith("cursor/")) continue;
    const id = ref.slice("cursor/".length);
    if (!id || !known.has(id.toLowerCase())) missing.push(ref);
  }
  return missing;
}

function assignedCursorRefs(): string[] {
  const refs: string[] = [];
  for (const agent of AGENT_NAMES) {
    const model = readAgentModel(agent);
    if (model) refs.push(model);
  }
  return refs;
}

function hasCursorCredentials(): boolean {
  const raw = readJson(inAgent("auth.json"));
  if (!raw || typeof raw !== "object") return false;
  return Boolean((raw as Record<string, unknown>).cursor);
}

/** Cursor catalog scan preconditions: credentials AND a live proxy descriptor file. */
export function cursorScanAvailable(): boolean {
  return hasCursorCredentials() && existsSync(inAgent("cursor-proxy.json"));
}

async function fetchCatalog(port: number): Promise<unknown[] | undefined> {
  const base = `http://127.0.0.1:${port}`;
  const post = await fetch(`${base}/internal/refresh-models`, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
  }).catch(() => undefined);
  if (post?.ok) {
    const body = (await post.json().catch(() => undefined)) as { models?: unknown } | undefined;
    const ids = modelIds(body?.models);
    if (ids.length > 0 && Array.isArray(body?.models)) return body.models;
  }
  const get = await fetch(`${base}/internal/models`, {
    signal: AbortSignal.timeout(8_000),
  }).catch(() => undefined);
  if (!get?.ok) return undefined;
  const body = (await get.json().catch(() => undefined)) as { models?: unknown } | undefined;
  if (!Array.isArray(body?.models) || modelIds(body.models).length === 0) return undefined;
  return body.models;
}

function baselineIds(): string[] {
  const saved = readScanState().ids;
  if (saved && saved.length > 0) return saved;
  return modelIds(readJson(inAgent("cursor-model-cache.json")));
}

export async function scanCursorModels(options?: { force?: boolean }): Promise<ScanResult> {
  if (!cursorScanAvailable()) return { status: "unavailable" };
  if (!options?.force && !scanDue()) return { status: "skipped" };
  const port = proxyPort();
  if (!port) return { status: "unavailable" };
  const models = await fetchCatalog(port);
  if (!models) return { status: "unavailable" };
  const ids = modelIds(models);
  const known = new Set(baselineIds());
  const added = ids.filter((id) => !known.has(id)).map((id) => `cursor/${id}`);
  const missing = missingCursorRefs(ids, assignedCursorRefs());
  mkdirSync(getAgentDir(), { recursive: true });
  writeFileSync(inAgent("cursor-model-cache.json"), JSON.stringify(models));
  const state: ScanState = { lastSuccess: new Date().toISOString(), ids };
  writeFileSync(inAgent("cursor-model-scan.json"), `${JSON.stringify(state, null, 2)}\n`);
  return { status: "ok", added, total: ids.length, missing };
}

export function formatNewModels(added: string[]): string {
  const shown = added.slice(0, 8).join(", ");
  const extra = added.length > 8 ? ` (+${added.length - 8} more)` : "";
  return `${shown}${extra}. Reload to use ids not already registered in this session.`;
}

export function orderModelRefs(scopedRefs: string[], availableRefs: string[]): Array<{ ref: string; scoped: boolean }> {
  const scopedSet = new Set(scopedRefs.map((ref) => ref.toLowerCase()));
  const seen = new Set<string>();
  const out: Array<{ ref: string; scoped: boolean }> = [];
  const push = (ref: string, scoped: boolean) => {
    const key = ref.toLowerCase();
    if (!ref || seen.has(key)) return;
    seen.add(key);
    out.push({ ref, scoped });
  };
  for (const ref of scopedRefs) push(ref, true);
  const rest = availableRefs.filter((ref) => !scopedSet.has(ref.toLowerCase())).sort((a, b) => a.localeCompare(b));
  for (const ref of rest) push(ref, false);
  return out;
}

export function pickerLabel(ref: string, scoped: boolean): string {
  return scoped ? `* ${ref}` : `  ${ref}`;
}

export function readEnabledModels(): string[] {
  const raw = readJson(inAgent("settings.json"));
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as { enabledModels?: unknown }).enabledModels;
  if (!Array.isArray(list)) return [];
  return list.filter((entry): entry is string => typeof entry === "string" && entry.includes("/"));
}

/** Append provider/id inside an enabledModels JSON array. Undefined when already present or the key is missing. */
export function insertEnabledModelText(text: string, modelRef: string): string | undefined {
  let settings: { enabledModels?: unknown };
  try {
    settings = JSON.parse(text) as { enabledModels?: unknown };
  } catch {
    return undefined;
  }
  const list = Array.isArray(settings.enabledModels)
    ? settings.enabledModels.filter((entry): entry is string => typeof entry === "string")
    : [];
  if (list.some((entry) => entry.toLowerCase() === modelRef.toLowerCase())) return undefined;
  const keyAt = text.indexOf('"enabledModels"');
  const open = keyAt >= 0 ? text.indexOf("[", keyAt) : -1;
  const close = open >= 0 ? text.indexOf("]", open) : -1;
  if (open < 0 || close < 0) return undefined;
  const before = text.slice(0, close).replace(/\s*$/, "");
  const comma = before.trimEnd().endsWith(",") || before.trimEnd().endsWith("[") ? "" : ",";
  return `${before}${comma}\n    ${JSON.stringify(modelRef)}\n  ${text.slice(close)}`;
}

/** Append provider/id to settings.json enabledModels. Returns whether it was new. */
export function appendEnabledModel(modelRef: string, root = getAgentDir()): boolean {
  const settingsPath = join(root, "settings.json");
  const text = readFileSync(settingsPath, "utf8");
  const next = insertEnabledModelText(text, modelRef);
  if (next === undefined) {
    let settings: { enabledModels?: unknown };
    try {
      settings = JSON.parse(text) as { enabledModels?: unknown };
    } catch {
      settings = {};
    }
    const list = Array.isArray(settings.enabledModels) ? settings.enabledModels : [];
    const present = list.some((entry) => typeof entry === "string" && entry.toLowerCase() === modelRef.toLowerCase());
    if (present) return false;
    settings.enabledModels = [
      ...list.filter((entry): entry is string => typeof entry === "string"),
      modelRef,
    ];
    writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    return true;
  }
  writeFileSync(settingsPath, next);
  return true;
}

function assertAgentFileName(agent: string): void {
  if (!AGENT_FILE_NAME.test(agent)) throw new Error(`invalid agent name: ${agent}`);
}

function agentPath(agent: string, root = getAgentDir()): string {
  assertAgentFileName(agent);
  return join(root, "agents", `${agent}.md`);
}

export function assertThinkingLevel(level: string): ThinkingLevel {
  if (!(THINKING_LEVELS as readonly string[]).includes(level)) {
    throw new Error(`invalid thinking level "${level}". One of: ${THINKING_LEVELS.join(", ")}`);
  }
  return level as ThinkingLevel;
}

/** Profiles in agents/*.md. Sidecar copies named *.ultimate-pi.md are skipped. */
export function listAgentProfiles(root = getAgentDir()): AgentProfile[] {
  let names: string[];
  try {
    names = readdirSync(join(root, "agents"));
  } catch {
    return [];
  }
  const profiles: AgentProfile[] = [];
  for (const file of names.sort()) {
    if (!file.endsWith(".md") || file.endsWith(".ultimate-pi.md")) continue;
    const name = file.slice(0, -".md".length);
    if (!AGENT_FILE_NAME.test(name)) continue;
    let text: string;
    try {
      text = readFileSync(join(root, "agents", file), "utf8");
    } catch {
      continue;
    }
    if (!text.startsWith("---")) continue;
    const end = text.indexOf("\n---", 3);
    const head = end < 0 ? text : text.slice(0, end);
    profiles.push({
      name,
      model: head.match(/^model:\s*(\S+)/m)?.[1],
      thinking: head.match(/^thinking:\s*(\S+)/m)?.[1],
      description: head.match(/^description:\s*(.+)$/m)?.[1]?.trim(),
    });
  }
  return profiles;
}

export function readAgentModel(agent: AgentName): string | undefined {
  try {
    const text = readFileSync(agentPath(agent), "utf8");
    if (!text.startsWith("---")) return undefined;
    const end = text.indexOf("\n---", 3);
    const head = end < 0 ? text : text.slice(0, end);
    return head.match(/^model:\s*(\S+)/m)?.[1];
  } catch {
    return undefined;
  }
}

/** Replace a frontmatter field, or insert it before the closing ---. */
export function replaceFrontmatterField(
  markdown: string,
  key: "model" | "thinking",
  value: string,
): string | undefined {
  if (!markdown.startsWith("---") || !value || /\s/.test(value)) return undefined;
  const end = markdown.indexOf("\n---", 3);
  if (end < 0) return undefined;
  const head = markdown.slice(0, end);
  const line = new RegExp(`^${key}:\\s*\\S+`, "m");
  if (line.test(head)) return head.replace(line, `${key}: ${value}`) + markdown.slice(end);
  return `${head}\n${key}: ${value}${markdown.slice(end)}`;
}

export function replaceModelLine(markdown: string, modelRef: string): string | undefined {
  if (!modelRef) {
    if (!markdown.startsWith("---")) return undefined;
    if (markdown.indexOf("\n---", 3) < 0) return undefined;
    return markdown;
  }
  return replaceFrontmatterField(markdown, "model", modelRef);
}

/** Slice out the ultimate-pi-managed region of AGENTS.md (between the markers), or undefined if absent. */
function markerRegion(markdown: string): { start: number; end: number; body: string } | undefined {
  const start = markdown.indexOf(AGENTS_MD_BEGIN_MARKER);
  const end = markdown.indexOf(AGENTS_MD_END_MARKER);
  if (start < 0 || end < 0 || end < start) return undefined;
  const bodyStart = start + AGENTS_MD_BEGIN_MARKER.length;
  return { start, end, body: markdown.slice(bodyStart, end) };
}

/** Replace an agent's model cell in the table, restricted to inside the begin/end markers. */
export function replaceAgentModelCell(markdown: string, agent: string, modelRef: string): string {
  const region = markerRegion(markdown);
  if (!region) return markdown;
  const pattern = new RegExp(`(\\| \`${agent}\` \\| )\`[^\`]+\``);
  if (!pattern.test(region.body)) return markdown;
  const updatedBody = region.body.replace(pattern, `$1\`${modelRef}\``);
  return (
    markdown.slice(0, region.start + AGENTS_MD_BEGIN_MARKER.length) +
    updatedBody +
    markdown.slice(region.end)
  );
}

export function writeAgentModel(agent: string, modelRef: string, root = getAgentDir()): { enabledAdded: boolean } {
  const path = agentPath(agent, root);
  const text = readFileSync(path, "utf8");
  const next = replaceModelLine(text, modelRef);
  if (!next) throw new Error(`no frontmatter in agents/${agent}.md`);
  writeFileSync(path, next);
  const agentsMdPath = join(root, "AGENTS.md");
  try {
    const agentsMd = readFileSync(agentsMdPath, "utf8");
    const updated = replaceAgentModelCell(agentsMd, agent, modelRef);
    if (updated !== agentsMd) writeFileSync(agentsMdPath, updated);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  return { enabledAdded: appendEnabledModel(modelRef, root) };
}

export function writeAgentThinking(agent: string, level: string, root = getAgentDir()): void {
  const thinking = assertThinkingLevel(level);
  const path = agentPath(agent, root);
  const text = readFileSync(path, "utf8");
  const next = replaceFrontmatterField(text, "thinking", thinking);
  if (!next) throw new Error(`no frontmatter in agents/${agent}.md`);
  writeFileSync(path, next);
}

function readAssignments(): AssignmentsFile {
  const raw = readJson(inAgent("model-agents.json"));
  if (!raw || typeof raw !== "object") return {};
  return raw as AssignmentsFile;
}

function validChain(chain: unknown): ModelRef[] | undefined {
  if (!Array.isArray(chain) || chain.length === 0) return undefined;
  const specs: ModelRef[] = [];
  for (const entry of chain) {
    if (!entry || typeof entry !== "object") return undefined;
    const provider = (entry as { provider?: unknown }).provider;
    const id = (entry as { id?: unknown }).id;
    if (typeof provider !== "string" || typeof id !== "string" || !provider || !id) return undefined;
    specs.push({ provider, id });
  }
  return specs;
}

/**
 * Resolution order (see lib/quota-fallback.ts header for full rationale):
 *   1. agentFallbacks[agentName]  — per-agent override ("main" = orchestrator)
 *   2. fallbacks[provider]        — global per-provider chain (old schema, still supported)
 *   3. defaults[provider]         — derived defaults passed in by the caller
 *   4. []                         — no fallback available
 */
/** Chain stored in model-agents.json only. Undefined when the file has no entry. */
export function readFileFallbackChain(provider: string, agentName?: string): ModelRef[] | undefined {
  const assignments = readAssignments();
  if (agentName) {
    const agentChain = validChain(assignments.agentFallbacks?.[agentName]);
    if (agentChain) return agentChain;
  }
  return validChain(assignments.fallbacks?.[provider]);
}

export function resolveFallbackChain(
  provider: string,
  defaults: Record<string, ModelRef[]>,
  agentName?: string,
): ModelRef[] {
  return readFileFallbackChain(provider, agentName) ?? defaults[provider] ?? [];
}

export function filterChainToScope(chain: ModelRef[], scopedRefs: readonly string[]): ModelRef[] {
  if (scopedRefs.length === 0) return chain;
  const allowed = new Set(scopedRefs.map((ref) => ref.toLowerCase()));
  return chain.filter((spec) => allowed.has(`${spec.provider}/${spec.id}`.toLowerCase()));
}

/**
 * When a scoped model list is set, 429 switches may only use a chain that is
 * both written in model-agents.json and present in that list. An empty scope
 * keeps the historical derived-default chain.
 */
export function resolveScopedSwitchChain(
  provider: string,
  defaults: Record<string, ModelRef[]>,
  agentName: string | undefined,
  scopedRefs: readonly string[],
): ModelRef[] {
  if (scopedRefs.length === 0) return resolveFallbackChain(provider, defaults, agentName);
  return filterChainToScope(readFileFallbackChain(provider, agentName) ?? [], scopedRefs);
}

export function writeFallbackChain(provider: string, chain: ModelRef[]): void {
  const current = readAssignments();
  const fallbacks = { ...(current.fallbacks ?? {}), [provider]: chain };
  writeFileSync(inAgent("model-agents.json"), `${JSON.stringify({ ...current, fallbacks }, null, 2)}\n`);
}

export function writeAgentFallbackChain(agentName: string, chain: ModelRef[]): void {
  const current = readAssignments();
  const agentFallbacks = { ...(current.agentFallbacks ?? {}), [agentName]: chain };
  writeFileSync(inAgent("model-agents.json"), `${JSON.stringify({ ...current, agentFallbacks }, null, 2)}\n`);
}

export function formatChain(chain: ModelRef[]): string {
  if (chain.length === 0) return "(none)";
  return chain.map((spec) => `${spec.provider}/${spec.id}`).join(", ");
}

export function splitModelRef(ref: string): ModelRef | undefined {
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) return undefined;
  return { provider: ref.slice(0, slash), id: ref.slice(slash + 1) };
}

/**
 * Providers the user actually has some usable configuration for: derived from
 * auth.json keys plus any provider referenced in model-agents.json's
 * fallbacks/agentFallbacks. Used to build sane derived fallback defaults
 * without hardcoding any product-specific provider list.
 */
export function listConfiguredProviders(): string[] {
  const providers = new Set<string>();
  const auth = readJson(inAgent("auth.json"));
  if (auth && typeof auth === "object") {
    for (const key of Object.keys(auth as Record<string, unknown>)) providers.add(key);
  }
  const assignments = readAssignments();
  for (const key of Object.keys(assignments.fallbacks ?? {})) providers.add(key);
  for (const chain of Object.values(assignments.agentFallbacks ?? {})) {
    for (const spec of chain) providers.add(spec.provider);
  }
  return [...providers];
}
