import fs from "node:fs/promises";
import { DEFAULT_MODELS_BY_PROVIDER, canonicalizeAnswersFields } from "./schema.mjs";

function catalogId(provider, index = 0) {
  return DEFAULT_MODELS_BY_PROVIDER[provider][index];
}

function defaultAnswers() {
  return {
    providers: [],
    agentAssignments: {},
    providerChains: {},
    agentFallbacks: {},
    packages: [],
    openrouterKey: undefined,
    deepseekKey: undefined,
    extras: { enabledExtras: [] },
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertShape(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("answers file must contain a single JSON object");
  }
  if (!("providers" in data)) {
    throw new Error('answers file is missing required field "providers"');
  }
  if (!Array.isArray(data.providers)) {
    throw new Error("answers.providers must be an array of { id, authMethod, credential? }");
  }
  for (const provider of data.providers) {
    if (!provider || typeof provider !== "object" || typeof provider.id !== "string") {
      throw new Error("each entry in answers.providers needs at least { id: string }");
    }
  }

  const hasAssignments = isPlainObject(data.agentAssignments);
  const hasAlias = isPlainObject(data.agentModels);
  if ("agentAssignments" in data && !hasAssignments) {
    throw new Error(
      "answers.agentAssignments must be an object keyed by agent name, e.g. { scout: { provider, model } }",
    );
  }
  if ("agentModels" in data && !hasAlias) {
    throw new Error(
      "answers.agentModels must be an object keyed by agent name, e.g. { scout: { provider, model } }",
    );
  }
  if (!hasAssignments && !hasAlias) {
    throw new Error(
      'answers file is missing required field "agentAssignments" (alias: "agentModels")',
    );
  }
}

/**
 * Load and validate a non-interactive answers file (the --answers <file> flag).
 * Fills in sane defaults for optional fields; throws a clear error naming the
 * missing/invalid field for anything required.
 *
 * Canonical keys are agentAssignments + top-level providerChains/agentFallbacks.
 * agentModels and nested fallbacks.* are accepted as aliases and normalized here.
 */
export async function loadAnswers(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`answers file not found: ${filePath}`);
    }
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`answers file is not valid JSON: ${filePath} (${err.message})`);
  }

  assertShape(parsed);

  const defaults = defaultAnswers();
  const canonical = canonicalizeAnswersFields(parsed);

  return {
    ...defaults,
    ...parsed,
    agentAssignments: { ...defaults.agentAssignments, ...canonical.agentAssignments },
    providerChains: { ...defaults.providerChains, ...canonical.providerChains },
    agentFallbacks: { ...defaults.agentFallbacks, ...canonical.agentFallbacks },
    extras: { ...defaults.extras, ...(parsed.extras ?? {}) },
  };
}

/**
 * Write an example/skeleton answers.json so users can hand-author one for
 * non-interactive installs (`ultimate-pi install --answers my-answers.json --yes`).
 * Model ids are taken from DEFAULT_MODELS_BY_PROVIDER so copy-paste resolves.
 */
export async function writeAnswersTemplate(filePath) {
  const template = {
    providers: [
      { id: "anthropic", authMethod: "oauth" },
      { id: "openrouter", authMethod: "api_key", credential: "<your-openrouter-api-key>" },
    ],
    agentAssignments: {
      scout: { provider: "cursor", model: catalogId("cursor", 0) },
      worker: { provider: "cursor", model: catalogId("cursor", 1) },
      planner: { provider: "anthropic", model: catalogId("anthropic", 1) },
      researcher: { provider: "openai-codex", model: catalogId("openai-codex", 0) },
      qa_tester: { provider: "cursor", model: catalogId("cursor", 0) },
    },
    // Top-level providerChains (not nested under fallbacks) — matches schema.mjs
    // and settings.mjs. Nested answers.fallbacks.providerChains is still accepted
    // as an alias by canonicalizeAnswersFields.
    providerChains: {
      anthropic: [{ provider: "openai-codex", id: catalogId("openai-codex", 0) }],
      "openai-codex": [{ provider: "anthropic", id: catalogId("anthropic", 0) }],
      cursor: [
        { provider: "openai-codex", id: catalogId("openai-codex", 0) },
        { provider: "anthropic", id: catalogId("anthropic", 0) },
      ],
    },
    agentFallbacks: {},
    packages: [],
    openrouterKey: undefined,
    deepseekKey: undefined,
    extras: { enabledExtras: [] },
  };
  await fs.writeFile(filePath, `${JSON.stringify(template, null, 2)}\n`, "utf8");
  return filePath;
}
