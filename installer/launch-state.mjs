import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Records the git checkout's root path into `<agentDir>/ultimate-pi-launch.json`
 * so `lib/launch-update.ts` can find the source for launch-time sync without a
 * hardcoded personal path. Only runs when `repoRoot` looks like a git checkout.
 * Merges into any existing state and creates the file if it is missing or
 * unparsable. Returns `true` when the file was written, `false` otherwise.
 */
export async function recordSourceRoot(agentDir, repoRoot) {
  if (!existsSync(join(repoRoot, ".git"))) return false;
  const statePath = join(agentDir, "ultimate-pi-launch.json");
  let existing = {};
  try {
    existing = JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    existing = {};
  }
  await mkdir(agentDir, { recursive: true });
  const next = { ...existing, sourceRoot: resolve(repoRoot) };
  await writeFile(statePath, `${JSON.stringify(next, null, 2)}\n`);
  return true;
}
