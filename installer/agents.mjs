import * as p from "@clack/prompts";
import {
  AGENT_NAMES,
  DEFAULT_MODELS_BY_PROVIDER,
  canonicalizeAnswersFields,
} from "./schema.mjs";

const MODELS_BY_PROVIDER = DEFAULT_MODELS_BY_PROVIDER;

// Default --yes routing when that provider was selected/authenticated this run.
// qa_tester has no per-role preference: first selected provider's catalog entry.
const PREFERRED_PROVIDER_BY_ROLE = {
  scout: "cursor",
  worker: "cursor",
  researcher: "openai-codex",
  planner: "anthropic",
};

function isCancelled(value) {
  if (p.isCancel(value)) {
    p.cancel("Agent model assignment cancelled.");
    process.exit(0);
  }
  return value;
}

function configuredIds(providers) {
  return (providers ?? []).map((entry) => (typeof entry === "string" ? entry : entry.id));
}

function modelChoices(providerIds) {
  const choices = [];
  for (const id of providerIds) {
    const models = MODELS_BY_PROVIDER[id] ?? [];
    if (models.length === 0) {
      choices.push({ value: `${id}::`, label: `${id} (custom model)` });
      continue;
    }
    for (const model of models) {
      choices.push({ value: `${id}::${model}`, label: `${id} / ${model}` });
    }
  }
  return choices;
}

function parseChoice(value) {
  const idx = value.indexOf("::");
  return { provider: value.slice(0, idx), model: value.slice(idx + 2) };
}

function assignmentsFromAnswers(answers) {
  // Canonical key is agentAssignments; agentModels is an explicit back-compat alias.
  const map = canonicalizeAnswersFields(answers).agentAssignments;
  if (!map || typeof map !== "object") return null;
  const out = {};
  for (const name of AGENT_NAMES) {
    const row = map[name];
    if (!row?.provider || !row?.model) return null;
    out[name] = { provider: row.provider, model: row.model };
  }
  return out;
}

function firstCatalogAssignment(providerId) {
  const models = MODELS_BY_PROVIDER[providerId] ?? [];
  return { provider: providerId, model: models[0] || "default" };
}

function defaultAssignments(providerIds) {
  const selected = new Set(providerIds);
  const fallbackProvider = providerIds[0];
  const fallback = fallbackProvider
    ? firstCatalogAssignment(fallbackProvider)
    : firstCatalogAssignment("anthropic");
  const out = {};
  for (const name of AGENT_NAMES) {
    const preferred = PREFERRED_PROVIDER_BY_ROLE[name];
    if (preferred && selected.has(preferred)) {
      out[name] = firstCatalogAssignment(preferred);
    } else {
      out[name] = { ...fallback };
    }
  }
  return out;
}

async function pickModel(agentName, choices) {
  const selected = isCancelled(
    await p.select({
      message: `Primary model for ${agentName}`,
      options: choices,
    }),
  );
  const assignment = parseChoice(selected);
  if (assignment.model) return assignment;

  const model = isCancelled(
    await p.text({
      message: `Model id for ${agentName} (${assignment.provider})`,
      validate: (value) => (value?.trim() ? undefined : "Model id is required"),
    }),
  );
  return { provider: assignment.provider, model: model.trim() };
}

/**
 * Per-agent primary model assignment (spec §4).
 * Returns { agentName: { provider, model } } for the installer to persist.
 */
export async function assignAgentModels(options = {}, providers = []) {
  const fromAnswers = assignmentsFromAnswers(options.answers);
  if (fromAnswers) return fromAnswers;

  const providerIds = configuredIds(providers);
  if (options.yes || options.dryRun) {
    return defaultAssignments(providerIds);
  }

  const choices = modelChoices(
    providerIds.length > 0 ? providerIds : Object.keys(MODELS_BY_PROVIDER),
  );
  const assignments = {};
  for (const name of AGENT_NAMES) {
    assignments[name] = await pickModel(name, choices);
  }
  return assignments;
}
