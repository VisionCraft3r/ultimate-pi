import fs from "node:fs/promises";
import path from "node:path";

const MODELS_FILE = "models.json";

/** Providers collected as local OpenAI-compatible endpoints. */
export function localProviderEntries(providers) {
  return (providers ?? []).filter(
    (provider) =>
      provider &&
      typeof provider.baseUrl === "string" &&
      provider.baseUrl &&
      Array.isArray(provider.models) &&
      provider.models.length > 0,
  );
}

async function readModelsFile(file) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`models.json must be a JSON object: ${file}`);
    }
    return parsed;
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

/**
 * Merge local endpoints into <agentDir>/models.json.
 * Keeps every other top-level key and provider. Does not write API keys
 * (those stay in auth.json). Backs up an existing file when backupSession is set.
 * Returns null when no local providers were collected.
 */
export async function mergeModelsJson(agentDir, providers, backupSession) {
  const locals = localProviderEntries(providers);
  if (locals.length === 0) return null;

  const file = path.join(agentDir, MODELS_FILE);
  if (backupSession) await backupSession.backupIfExists(MODELS_FILE);
  const existing = await readModelsFile(file);
  const previousProviders =
    existing.providers && typeof existing.providers === "object" && !Array.isArray(existing.providers)
      ? existing.providers
      : {};
  const nextProviders = { ...previousProviders };

  for (const provider of locals) {
    const previous = nextProviders[provider.id];
    const block =
      previous && typeof previous === "object" && !Array.isArray(previous) ? { ...previous } : {};
    block.baseUrl = provider.baseUrl;
    block.api = provider.api || "openai-completions";
    block.models = provider.models.map((id) => ({ id }));
    nextProviders[provider.id] = block;
  }

  const next = { ...existing, providers: nextProviders };
  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}
