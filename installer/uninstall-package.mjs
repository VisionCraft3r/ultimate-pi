import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SETTINGS_FILE = "settings.json";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLISHED_SELF = "git:github.com/VisionCraft3r/ultimate-pi";

function isSelfSource(spec) {
  return spec === ROOT || spec === PUBLISHED_SELF;
}

function malformedSettings(detail, file) {
  return new Error(
    `malformed ${SETTINGS_FILE}: ${detail}; refusing to write (${file})`,
  );
}

/**
 * Remove only this checkout's exact self source and/or
 * `git:github.com/VisionCraft3r/ultimate-pi` from `<agentDir>/settings.json`
 * `packages`. Other package specs, other settings keys, and `auth.json` are
 * left untouched. Does not run `pi remove`.
 *
 * Missing `settings.json` or a settings object with no matching self spec is
 * a no-op. Malformed JSON / non-object settings / a non-string `packages`
 * array throw before write. `options.dryRun` reports planned removals with
 * no backup or write. Non-dry-run writes require `backupSession.backupIfExists`.
 */
export async function removeUltimatePiPackage(agentDir, backupSession, options = {}) {
  const file = path.join(agentDir, SETTINGS_FILE);
  let raw;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { removed: [] };
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw malformedSettings(`not valid JSON (${err.message})`, file);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw malformedSettings("must be a JSON object", file);
  }

  if (parsed.packages === undefined) {
    return { removed: [] };
  }
  if (!Array.isArray(parsed.packages) || parsed.packages.some((entry) => typeof entry !== "string")) {
    throw malformedSettings("packages must be an array of strings", file);
  }

  const removed = parsed.packages.filter((spec) => isSelfSource(spec));
  const packages = parsed.packages.filter((spec) => !isSelfSource(spec));

  if (options.dryRun) {
    return { removed, packages, dryRun: true };
  }
  if (removed.length === 0) {
    return { removed, packages };
  }

  if (typeof backupSession?.backupIfExists !== "function") {
    throw new Error(
      `backupSession.backupIfExists is required before removing ${SETTINGS_FILE} package specs`,
    );
  }
  await backupSession.backupIfExists(SETTINGS_FILE);

  const next = { ...parsed, packages };
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { removed, packages };
}

/**
 * Spawn `pi remove <source>` (adds `--local` when `options.local`).
 * No shell. Rejects on spawn failure or nonzero exit. Does not touch keys.
 */
export function runPiRemove(source, options = {}) {
  const args = ["remove", source, ...(options.local ? ["--local"] : [])];
  return new Promise((resolve, reject) => {
    const child = spawn("pi", args, {
      stdio: "inherit",
      env: { ...process.env, PI_CODING_AGENT_DIR: options.agentDir },
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pi remove ${source} exited ${code}`));
    });
  });
}
