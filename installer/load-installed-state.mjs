import fs from "node:fs/promises";
import path from "node:path";
import {
  AGENT_NAMES,
  asModelRef,
  modelForProviderFromAssignments,
  normalizeAgentFallbacks,
  normalizeFallbacksMap,
  splitModelRef,
} from "./schema.mjs";

async function readJsonIfExists(file, label) {
  let raw;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return undefined;
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${label} is not valid JSON: ${file} (${err.message})`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object: ${file}`);
  }
  return parsed;
}

function requireMap(value, label, file) {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object: ${file}`);
  }
}

function requireChainHops(map, label, file) {
  if (!map) return;
  for (const [key, chain] of Object.entries(map)) {
    const list = Array.isArray(chain) ? chain : Array.isArray(chain?.chain) ? chain.chain : null;
    if (!list) {
      throw new Error(`${label}.${key} must be an array of model refs: ${file}`);
    }
    for (const entry of list) {
      if (asModelRef(entry)) continue;
      if (typeof entry === "string" && entry.trim() && !entry.includes("/")) continue;
      throw new Error(`${label}.${key} has a malformed hop: ${file}`);
    }
  }
}

function parseAgentFrontmatter(text, relativePath) {
  if (!text.startsWith("---")) {
    throw new Error(`${relativePath} is missing YAML frontmatter`);
  }
  const end = text.indexOf("\n---", 3);
  const head = end < 0 ? text : text.slice(0, end);
  const modelLine = head.match(/^model:\s*(\S+)/m);
  if (!modelLine) {
    throw new Error(`${relativePath} is missing a model: provider/id frontmatter field`);
  }
  const ref = splitModelRef(modelLine[1]);
  if (!ref) {
    throw new Error(`${relativePath} has invalid model: ${modelLine[1]} (expected provider/id)`);
  }
  const assignment = { provider: ref.provider, model: ref.id };
  const thinkingLine = head.match(/^thinking:\s*(\S+)/m);
  if (thinkingLine) assignment.thinking = thinkingLine[1];
  return assignment;
}

/**
 * Read already-installed installer state from an agent dir.
 * Missing files yield empty fields; malformed existing files throw.
 */
export async function loadInstalledState(agentDir) {
  const settingsFile = path.join(agentDir, "settings.json");
  const modelAgentsFile = path.join(agentDir, "model-agents.json");

  const settings = await readJsonIfExists(settingsFile, "settings.json");
  let packages = [];
  if (settings && settings.packages !== undefined) {
    if (!Array.isArray(settings.packages) || settings.packages.some((entry) => typeof entry !== "string")) {
      throw new Error(`settings.json packages must be an array of strings: ${settingsFile}`);
    }
    packages = settings.packages;
  }

  const modelAgents = await readJsonIfExists(modelAgentsFile, "model-agents.json");
  requireMap(modelAgents?.fallbacks, "model-agents.json fallbacks", modelAgentsFile);
  requireMap(modelAgents?.agentFallbacks, "model-agents.json agentFallbacks", modelAgentsFile);
  requireChainHops(modelAgents?.fallbacks, "model-agents.json fallbacks", modelAgentsFile);
  requireChainHops(modelAgents?.agentFallbacks, "model-agents.json agentFallbacks", modelAgentsFile);

  const agentAssignments = {};
  for (const name of AGENT_NAMES) {
    const relativePath = path.join("agents", `${name}.md`);
    const file = path.join(agentDir, relativePath);
    let text;
    try {
      text = await fs.readFile(file, "utf8");
    } catch (err) {
      if (err.code === "ENOENT") continue;
      throw err;
    }
    agentAssignments[name] = parseAgentFrontmatter(text, relativePath);
  }

  const lookup = modelForProviderFromAssignments(agentAssignments);
  return {
    packages,
    providerChains: normalizeFallbacksMap(modelAgents?.fallbacks, lookup),
    agentFallbacks: normalizeAgentFallbacks(modelAgents?.agentFallbacks, lookup),
    agentAssignments,
  };
}
