import fs from "node:fs/promises";
import path from "node:path";
import {
  modelForProviderFromAssignments,
  normalizeAgentFallbacks,
  normalizeFallbacksMap,
} from "./schema.mjs";

const MODEL_AGENTS_FILE = "model-agents.json";

function modelAgentsPath(agentDir) {
  return path.join(agentDir, MODEL_AGENTS_FILE);
}

async function readExisting(file) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    return {};
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

/**
 * Write <agentDir>/model-agents.json with fallbacks + agentFallbacks as ModelRef[].
 * Backs up any existing file via backupSession, then preserves unrelated keys.
 */
export async function writeModelConfig(
  agentDir,
  providerChains,
  agentFallbacks,
  backupSession,
) {
  const file = modelAgentsPath(agentDir);
  const lookup = modelForProviderFromAssignments();
  const fallbacks = normalizeFallbacksMap(providerChains, lookup);
  const normalizedAgentFallbacks = normalizeAgentFallbacks(agentFallbacks, lookup);

  if (backupSession?.backupIfExists) {
    await backupSession.backupIfExists(MODEL_AGENTS_FILE);
  }

  const next = {
    ...(await readExisting(file)),
    fallbacks,
    agentFallbacks: normalizedAgentFallbacks,
  };

  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}
