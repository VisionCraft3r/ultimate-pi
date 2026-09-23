import fs from "node:fs/promises";

const REQUIRED_TOP_LEVEL = ["providers", "agentAssignments"];

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

function assertShape(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("answers file must contain a single JSON object");
  }
  for (const field of REQUIRED_TOP_LEVEL) {
    if (!(field in data)) {
      throw new Error(`answers file is missing required field "${field}"`);
    }
  }
  if (!Array.isArray(data.providers)) {
    throw new Error('answers.providers must be an array of { id, authMethod, credential? }');
  }
  for (const provider of data.providers) {
    if (!provider || typeof provider !== "object" || typeof provider.id !== "string") {
      throw new Error('each entry in answers.providers needs at least { id: string }');
    }
  }
  if (typeof data.agentAssignments !== "object" || Array.isArray(data.agentAssignments)) {
    throw new Error('answers.agentAssignments must be an object keyed by agent name, e.g. { scout: { provider, model } }');
  }
}

/**
 * Load and validate a non-interactive answers file (the --answers <file> flag).
 * Fills in sane defaults for optional fields; throws a clear error naming the
 * missing/invalid field for anything required.
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

  return {
    ...defaultAnswers(),
    ...parsed,
    providerChains: { ...defaultAnswers().providerChains, ...(parsed.providerChains ?? {}) },
    agentFallbacks: { ...defaultAnswers().agentFallbacks, ...(parsed.agentFallbacks ?? {}) },
    extras: { ...defaultAnswers().extras, ...(parsed.extras ?? {}) },
  };
}

/**
 * Write an example/skeleton answers.json so users can hand-author one for
 * non-interactive installs (`ultimate-pi install --answers my-answers.json --yes`).
 */
export async function writeAnswersTemplate(filePath) {
  const template = {
    providers: [
      { id: "anthropic", authMethod: "oauth" },
      { id: "openrouter", authMethod: "api_key", credential: "<your-openrouter-api-key>" },
    ],
    agentAssignments: {
      scout: { provider: "cursor", model: "cursor-grok-4.6-medium" },
      worker: { provider: "cursor", model: "cursor-grok-4.6-xhigh" },
      planner: { provider: "anthropic", model: "claude-opus-5-5" },
      researcher: { provider: "openai-codex", model: "gpt-6-sol" },
      qa_tester: { provider: "cursor", model: "cursor-grok-4.6-medium" },
    },
    providerChains: {
      anthropic: [{ provider: "openai-codex", id: "gpt-6-sol" }],
      "openai-codex": [{ provider: "anthropic", id: "claude-sonnet-5" }],
      cursor: [
        { provider: "openai-codex", id: "gpt-6-sol" },
        { provider: "anthropic", id: "claude-sonnet-5" },
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
