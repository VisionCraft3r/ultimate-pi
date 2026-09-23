import fs from "node:fs/promises";
import path from "node:path";

const AUTH_FILE = "auth.json";
const AUTH_BACKUP = "auth.json.bak";

export function authPath(agentDir) {
  return path.join(agentDir, AUTH_FILE);
}

export async function readAuth(agentDir) {
  try {
    const raw = await fs.readFile(authPath(agentDir), "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

export async function writeAuth(agentDir, data) {
  const file = authPath(agentDir);
  await fs.mkdir(agentDir, { recursive: true });
  const body = JSON.stringify(data, null, 2) + "\n";
  await fs.writeFile(file, body, { mode: 0o600 });
  await fs.chmod(file, 0o600);
  return file;
}

/**
 * Merge API-key credentials into <agentDir>/auth.json.
 * Backs up any pre-existing file to auth.json.bak, leaves OAuth entries
 * (written by `pi` /login) untouched, and chmod 600 the result.
 */
export async function mergeCredentials(agentDir, providers) {
  const file = authPath(agentDir);
  const existing = await readAuth(agentDir);

  try {
    await fs.access(file);
    await fs.copyFile(file, path.join(agentDir, AUTH_BACKUP));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  const next = { ...existing };
  for (const provider of providers ?? []) {
    if (provider.authMethod === "oauth") continue;
    if (!provider.credential) continue;
    next[provider.id] = { type: "api_key", key: provider.credential };
  }

  await writeAuth(agentDir, next);
  return next;
}
