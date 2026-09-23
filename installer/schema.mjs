/** Shared installer types: agent names, model refs, fallback-chain normalization. */

export const AGENT_NAMES = ["scout", "worker", "planner", "researcher", "qa_tester"];
export const SESSION_NAMES = ["main", ...AGENT_NAMES];
export const MANAGED_AGENT_MARKER = "<!-- managed-by: ultimate-pi -->";
export const AGENTS_MD_BEGIN = "<!-- ultimate-pi:begin -->";
export const AGENTS_MD_END = "<!-- ultimate-pi:end -->";

export const PROVIDER_LABELS = {
  anthropic: "Anthropic",
  "openai-codex": "OpenAI Codex",
  cursor: "Cursor",
  openrouter: "OpenRouter",
  deepseek: "DeepSeek",
  openai: "OpenAI",
  other: "custom provider",
};

export const ENV_VAR_BY_PROVIDER = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
};

export const DEFAULT_MODELS_BY_PROVIDER = {
  anthropic: ["claude-sonnet-4.6", "claude-opus-4.6", "claude-haiku-4.5"],
  "openai-codex": ["gpt-5.4", "gpt-5.3-codex"],
  cursor: ["composer-1.5", "grok-4.5", "gpt-5.3-codex"],
  openrouter: ["openai/gpt-4.1-mini", "anthropic/claude-sonnet-4.6", "deepseek/deepseek-chat"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  openai: ["gpt-4.1", "gpt-4.1-mini"],
  other: [],
};

export const DEFAULT_PROVIDER_ORDER = [
  "anthropic",
  "openai-codex",
  "cursor",
  "openrouter",
  "openai",
  "deepseek",
  "other",
];

/** Split `provider/id` on the first slash. */
export function splitModelRef(ref) {
  if (typeof ref !== "string") return undefined;
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) return undefined;
  return { provider: ref.slice(0, slash), id: ref.slice(slash + 1) };
}

export function formatModelRef(ref) {
  if (!ref) return "";
  if (typeof ref === "string") return ref;
  const provider = ref.provider;
  const id = ref.id ?? ref.model;
  if (!provider || !id) return "";
  return `${provider}/${id}`;
}

/** Coerce a hop into `{ provider, id }` as lib/model-agents.ts validChain() expects. */
export function asModelRef(entry) {
  if (!entry) return undefined;
  if (typeof entry === "string") {
    return splitModelRef(entry);
  }
  if (typeof entry === "object") {
    const provider = entry.provider;
    const id = entry.id ?? entry.model;
    if (typeof provider === "string" && provider && typeof id === "string" && id) {
      return { provider, id };
    }
  }
  return undefined;
}

/**
 * Normalize a fallback chain to ModelRef[].
 * Accepts ModelRef objects, `provider/id` strings, `{ chain: [...] }` wrappers,
 * and (with `modelForProvider`) bare provider ids.
 */
export function normalizeChain(chain, modelForProvider) {
  if (!chain) return [];
  const list = Array.isArray(chain) ? chain : Array.isArray(chain.chain) ? chain.chain : [];
  const out = [];
  const seen = new Set();
  for (const entry of list) {
    let ref = asModelRef(entry);
    if (!ref && typeof entry === "string" && !entry.includes("/") && typeof modelForProvider === "function") {
      const id = modelForProvider(entry);
      if (id) ref = { provider: entry, id };
    }
    if (!ref) continue;
    const key = `${ref.provider}/${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ provider: ref.provider, id: ref.id });
  }
  return out;
}

export function normalizeFallbacksMap(map, modelForProvider) {
  const out = {};
  if (!map || typeof map !== "object" || Array.isArray(map)) return out;
  for (const [provider, chain] of Object.entries(map)) {
    const hops = normalizeChain(chain, modelForProvider);
    if (hops.length > 0) out[provider] = hops;
  }
  return out;
}

export function normalizeAgentFallbacks(map, modelForProvider) {
  const out = {};
  if (!map || typeof map !== "object" || Array.isArray(map)) return out;
  for (const [name, chain] of Object.entries(map)) {
    const hops = normalizeChain(chain, modelForProvider);
    if (hops.length > 0) out[name] = hops;
  }
  return out;
}

export function modelForProviderFromAssignments(assignments = {}) {
  const order = ["planner", "worker", "researcher", "scout", "qa_tester", "main"];
  return (providerId) => {
    for (const name of order) {
      const row = assignments[name];
      if (row?.provider === providerId && (row.model || row.id)) return row.model ?? row.id;
    }
    const catalog = DEFAULT_MODELS_BY_PROVIDER[providerId];
    return catalog?.[0] ?? "default";
  };
}

export function collectEnabledModels(allAnswers = {}) {
  const models = [];
  const seen = new Set();
  const push = (ref) => {
    const formatted = formatModelRef(ref);
    if (!formatted) return;
    const key = formatted.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    models.push(formatted);
  };

  for (const row of Object.values(allAnswers.agentAssignments ?? {})) {
    if (row?.provider && (row.model || row.id)) {
      push({ provider: row.provider, id: row.model ?? row.id });
    }
  }

  const lookup = modelForProviderFromAssignments(allAnswers.agentAssignments);
  for (const chain of Object.values(normalizeFallbacksMap(allAnswers.providerChains, lookup))) {
    for (const hop of chain) push(hop);
  }
  for (const chain of Object.values(normalizeAgentFallbacks(allAnswers.agentFallbacks, lookup))) {
    for (const hop of chain) push(hop);
  }
  return models;
}

export function providerHasCredentials(auth, providerId, env = process.env) {
  if (!providerId) return false;
  const entry = auth?.[providerId];
  if (entry && typeof entry === "object") {
    if (entry.type === "api_key" && typeof entry.key === "string" && entry.key.length > 0) return true;
    if (entry.type === "oauth") return true;
    if (typeof entry.key === "string" && entry.key.length > 0) return true;
    return true;
  }
  const envVar = ENV_VAR_BY_PROVIDER[providerId];
  if (envVar && typeof env[envVar] === "string" && env[envVar].trim()) return true;
  return false;
}

export function assignmentModelRef(assignment) {
  if (!assignment?.provider) return undefined;
  const id = assignment.model ?? assignment.id;
  if (!id) return undefined;
  return { provider: assignment.provider, id };
}
