import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SETTINGS_FILE = "settings.json";
const MODEL_AGENTS_FILE = "model-agents.json";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLISHED_SELF = "git:github.com/VisionCraft3r/ultimate-pi";

/** Third-party packages Ultimate Pi may install. Used by `--full` / `--purge` uninstall. */
export const ULTIMATE_PI_THIRD_PARTY_PREFIXES = [
  "git:github.com/amosblomqvist/pi-interactive-subagents",
  "git:github.com/amosblomqvist/pi-observational-memory",
  "npm:pi-lens",
  "npm:pi-graft",
  "npm:@plannotator/pi-extension",
  "npm:pi-cache-graph",
  "npm:@gotgenes/pi-anthropic-auth",
  "npm:@schultzp2020/pi-cursor",
];

function isSelfSource(spec) {
  return spec === ROOT || spec === PUBLISHED_SELF;
}

export function isUltimatePiThirdPartySpec(spec) {
  if (typeof spec !== "string") return false;
  return ULTIMATE_PI_THIRD_PARTY_PREFIXES.some(
    (prefix) => spec === prefix || spec.startsWith(`${prefix}@`),
  );
}

export function wantsFullUninstall(options = {}) {
  if (options.full || options.purge) return true;
  const argv = process.argv ?? [];
  return argv.includes("--full") || argv.includes("--purge");
}

export async function describeRemainingBackups(agentDir) {
  const backupsRoot = path.join(agentDir, "backups");
  try {
    const entries = await fs.readdir(backupsRoot);
    if (entries.length === 0) {
      return `No installer backups remain at ${backupsRoot}. auth.json was not modified.`;
    }
    return (
      `Installer backups were not deleted. Remaining backups are under ${backupsRoot} ` +
      `(${entries.join(", ")}). Delete that directory manually if you want them gone. ` +
      `auth.json was not modified.`
    );
  } catch (err) {
    if (err.code === "ENOENT") {
      return `No installer backups directory at ${backupsRoot}. auth.json was not modified.`;
    }
    throw err;
  }
}

export async function removeModelAgentsJson(agentDir, backupSession, options = {}) {
  const file = path.join(agentDir, MODEL_AGENTS_FILE);
  try {
    await fs.stat(file);
  } catch (err) {
    if (err.code === "ENOENT") return { removed: false };
    throw err;
  }
  if (options.dryRun) {
    return { removed: true, dryRun: true };
  }
  if (typeof backupSession?.backupIfExists !== "function") {
    throw new Error(
      `backupSession.backupIfExists is required before removing ${MODEL_AGENTS_FILE}`,
    );
  }
  await backupSession.backupIfExists(MODEL_AGENTS_FILE);
  await fs.unlink(file);
  return { removed: true };
}

async function withFullExtras(agentDir, backupSession, options, result) {
  if (!wantsFullUninstall(options)) return result;
  const modelAgents = await removeModelAgentsJson(agentDir, backupSession, options);
  const backupsNote = await describeRemainingBackups(agentDir);
  return {
    ...result,
    modelAgentsRemoved: Boolean(modelAgents.removed),
    backupsNote,
  };
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
 * left untouched unless `options.full` / `options.purge` (or CLI `--full` / `--purge`)
 * is set, in which case Ultimate Pi third-party packages and `model-agents.json` are
 * also removed. `auth.json` is never touched. Does not run `pi remove`.
 *
 * Missing `settings.json` or a settings object with no matching self spec is
 * a no-op (full uninstall still removes `model-agents.json` if present). Malformed JSON / non-object settings / a non-string `packages`
 * array throw before write. `options.dryRun` reports planned removals with
 * no backup or write. Non-dry-run writes require `backupSession.backupIfExists`.
 */
export async function removeUltimatePiPackage(agentDir, backupSession, options = {}) {
  const file = path.join(agentDir, SETTINGS_FILE);
  let raw;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      return withFullExtras(agentDir, backupSession, options, { removed: [] });
    }
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
    return withFullExtras(agentDir, backupSession, options, { removed: [] });
  }
  if (!Array.isArray(parsed.packages) || parsed.packages.some((entry) => typeof entry !== "string")) {
    throw malformedSettings("packages must be an array of strings", file);
  }

  const removed = parsed.packages.filter((spec) =>
    isSelfSource(spec) || (wantsFullUninstall(options) && isUltimatePiThirdPartySpec(spec)),
  );
  const packages = parsed.packages.filter((spec) => !removed.includes(spec));

  if (options.dryRun) {
    return withFullExtras(agentDir, backupSession, options, { removed, packages, dryRun: true });
  }
  if (removed.length === 0) {
    return withFullExtras(agentDir, backupSession, options, { removed, packages });
  }

  if (typeof backupSession?.backupIfExists !== "function") {
    throw new Error(
      `backupSession.backupIfExists is required before removing ${SETTINGS_FILE} package specs`,
    );
  }
  await backupSession.backupIfExists(SETTINGS_FILE);

  const next = { ...parsed, packages };
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return withFullExtras(agentDir, backupSession, options, { removed, packages });
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
