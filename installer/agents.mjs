import * as p from "@clack/prompts";

const AGENT_NAMES = ["scout", "worker", "planner", "researcher", "qa_tester"];

const MODELS_BY_PROVIDER = {
  anthropic: ["claude-opus-4.6", "claude-sonnet-4.6", "claude-haiku-4.5"],
  "openai-codex": ["gpt-5.4", "gpt-5.3-codex"],
  cursor: ["composer-1.5", "grok-4.5", "gpt-5.3-codex"],
  openrouter: [
    "anthropic/claude-sonnet-4.6",
    "openai/gpt-5.4",
    "deepseek/deepseek-chat",
  ],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  openai: ["gpt-5.4", "gpt-4.1"],
  other: [],
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
  const map = answers?.agentModels;
  if (!map || typeof map !== "object") return null;
  const out = {};
  for (const name of AGENT_NAMES) {
    const row = map[name];
    if (!row?.provider || !row?.model) return null;
    out[name] = { provider: row.provider, model: row.model };
  }
  return out;
}

function defaultAssignments(providerIds) {
  const choices = modelChoices(providerIds);
  const fallback = choices[0]
    ? parseChoice(choices[0].value)
    : { provider: "anthropic", model: "claude-sonnet-4.6" };
  if (!fallback.model) fallback.model = "default";
  const out = {};
  for (const name of AGENT_NAMES) out[name] = { ...fallback };
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
