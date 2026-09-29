/**
 * Launch-time updater. Applies patch/minor npm updates that stay on known-good
 * pins, and copies a newer Ultimate PI checkout into the agent dir only after
 * its tests pass. Major bumps and patched packages that would leave their pin
 * are left in place.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { copyExtensionTree } from "./extension-layout.ts";

const PATCH_PINS: Record<string, string> = {
  "@schultzp2020/pi-cursor": "0.5.2",
  "pi-graft": "0.1.2",
};

/** How long a parent session waits before asking npm for package versions again. */
export const NPM_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function isSubagentSession(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.PI_SUBAGENT_AGENT?.trim()) return true;
  return Number(env.PI_SUBAGENT_DEPTH ?? "0") >= 1;
}

export function npmCheckDue(checkedAt: unknown, now = Date.now()): boolean {
  if (typeof checkedAt !== "string" || !checkedAt) return true;
  const then = Date.parse(checkedAt);
  if (!Number.isFinite(then)) return true;
  return now - then >= NPM_CHECK_INTERVAL_MS;
}

const SYNC_DIRS = ["extensions", "lib", "templates", "skills", "patches"];

export type NpmUpdateDecision = "current" | "apply" | "skip-major" | "skip-patch-pin";

export function parsePiVersion(text: string): string | null {
  return text.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
}

export function versionAtLeast(version: string, minimum: string): boolean {
  const left = version.split(".").map((part) => Number(part));
  const right = minimum.split(".").map((part) => Number(part));
  for (let i = 0; i < 3; i += 1) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta > 0) return true;
    if (delta < 0) return false;
  }
  return true;
}

export function classifyNpmUpdate(current: string, latest: string, packageName: string): NpmUpdateDecision {
  if (!current || !latest || current === latest) return "current";
  const currentMajor = Number(current.split(".")[0]);
  const latestMajor = Number(latest.split(".")[0]);
  if (Number.isFinite(currentMajor) && Number.isFinite(latestMajor) && latestMajor > currentMajor) {
    return "skip-major";
  }
  const pin = PATCH_PINS[packageName];
  if (pin && latest !== pin) return "skip-patch-pin";
  return "apply";
}

export function plannotatorUpdateAllowed(packageName: string, piVersion: string | null): boolean {
  if (packageName !== "@plannotator/pi-extension") return true;
  return Boolean(piVersion && versionAtLeast(piVersion, "0.79.1"));
}

export function npmPackageName(spec: string): string | null {
  if (!spec.startsWith("npm:")) return null;
  const rest = spec.slice(4).trim();
  if (!rest) return null;
  if (rest.startsWith("@")) {
    const match = rest.match(/^(@[^/]+\/[^@]+)(?:@.+)?$/);
    return match ? match[1] : rest;
  }
  const at = rest.indexOf("@");
  return at >= 0 ? rest.slice(0, at) : rest;
}

function isGitLikeSpec(spec: string): boolean {
  return (
    spec.startsWith("git:") ||
    spec.startsWith("https://") ||
    spec.startsWith("http://") ||
    spec.startsWith("ssh://") ||
    spec.startsWith("git@")
  );
}

function gitRepo(spec: string): string {
  let value = spec.trim();
  if (value.startsWith("git:")) value = value.slice(4);
  if (value.startsWith("git@github.com:")) value = `github.com/${value.slice("git@github.com:".length)}`;
  value = value.replace(/^https?:\/\//, "").replace(/^ssh:\/\/git@/, "").replace(/\.git$/, "");
  const slash = value.lastIndexOf("/");
  const at = value.lastIndexOf("@");
  if (at > slash) value = value.slice(0, at);
  return value.replace(/\/+$/, "");
}

export function gitCheckoutDir(agentDir: string, spec: string): string | null {
  if (!isGitLikeSpec(spec)) return null;
  const repo = gitRepo(spec);
  if (!repo) return null;
  return join(agentDir, "git", ...repo.split("/").filter(Boolean));
}

/** Installed git checkouts stay on their commit. Missing checkouts are the only note. */
export function nonNpmPackageNote(agentDir: string, spec: string): string | null {
  const checkout = gitCheckoutDir(agentDir, spec);
  if (!checkout || existsSync(checkout)) return null;
  return `skipped ${spec}; not installed`;
}

function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
}

function resolvePiBinary(): string {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, "pi");
    if (existsSync(candidate)) return candidate;
  }
  return "pi";
}

/** Re-invoke this Pi process's Node entry. The `pi` on PATH may be a shell wrapper that starts a chat session. */
function piCliInvocation(extra: string[]): { command: string; args: string[] } {
  const entry = process.argv[1];
  if (entry && existsSync(entry)) return { command: process.execPath, args: [entry, ...extra] };
  return { command: resolvePiBinary(), args: extra };
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function installedVersion(dir: string, packageName: string): string | null {
  const manifest = readJson(join(dir, "npm/node_modules", packageName, "package.json"));
  return typeof manifest?.version === "string" ? manifest.version : null;
}

function killProcessGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already exited
    }
  }
}

function run(command: string, args: string[], cwd?: string, timeoutMs = 20000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (code: number | null, extraStderr = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolvePromise({ code, stdout, stderr: `${stderr}${extraStderr}` });
    };
    const timer = setTimeout(() => {
      killProcessGroup(child.pid, "SIGTERM");
      killTimer = setTimeout(() => {
        killProcessGroup(child.pid, "SIGKILL");
        finish(null, `\ntimed out after ${timeoutMs}ms`);
      }, 2000);
    }, timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      finish(1, err.message);
    });
    child.on("close", (code) => {
      finish(code);
    });
  });
}

function lockHolderAlive(lockPath: string): boolean {
  try {
    const pid = Number(readFileSync(lockPath, "utf8").trim());
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
    return code === "EPERM";
  }
}

export function findUltimatePiSource(): string | null {
  const fromEnv = process.env.ULTIMATE_PI_ROOT?.trim();
  const candidates = [
    fromEnv,
    join(homedir(), "Documents/UltimatePI/ultimate-pi"),
    fileURLToPath(new URL("..", import.meta.url)),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const manifest = readJson(join(candidate, "package.json"));
    if (manifest?.name === "ultimate-pi") return resolve(candidate);
  }
  return null;
}

function hashTree(root: string): string {
  const hash = createHash("sha256");
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      if (name === "node_modules" || name === "dist") continue;
      const path = join(dir, name);
      const info = statSync(path);
      hash.update(path.slice(root.length));
      if (info.isDirectory()) walk(path);
      else hash.update(readFileSync(path));
    }
  };
  for (const dir of SYNC_DIRS) walk(join(root, dir));
  return hash.digest("hex");
}

export function copySource(source: string, dest: string): string[] {
  const skipped: string[] = [];
  for (const dir of SYNC_DIRS) {
    const from = join(source, dir);
    if (!existsSync(from)) continue;
    if (dir === "extensions") {
      skipped.push(...copyExtensionTree(from, join(dest, dir)));
      continue;
    }
    cpSync(from, join(dest, dir), { recursive: true });
  }
  return skipped;
}

async function syncSource(dir: string, options: { skipTests: boolean }): Promise<string> {
  const source = findUltimatePiSource();
  if (!source) return "no Ultimate PI checkout to sync";
  const next = hashTree(source);
  const statePath = join(dir, "ultimate-pi-launch.json");
  const state = readJson(statePath);
  if (state?.hash === next) return "Ultimate PI checkout already installed";
  if (!options.skipTests) {
    const tested = await run(process.execPath, ["--experimental-strip-types", "--test", "test/launch-update.test.ts", "test/fallback-resolution.test.ts"], source, 120000);
    if (tested.code !== 0) {
      return `held Ultimate PI sync; tests failed (${tested.stderr.split("\n").find((line) => line.trim()) || "see test output"})`;
    }
  }
  const skipped = copySource(source, dir);
  const previous = readJson(statePath) ?? {};
  writeFileSync(statePath, `${JSON.stringify({ ...previous, hash: next, at: new Date().toISOString() }, null, 2)}\n`);
  const note = "synced Ultimate PI checkout into the agent dir";
  if (skipped.length === 0) return note;
  return `${note}; left non-factory files out of extensions/: ${skipped.join(", ")}`;
}

async function updateNpmPackages(dir: string): Promise<string[]> {
  const settings = readJson(join(dir, "settings.json"));
  const packages = Array.isArray(settings?.packages) ? settings.packages.filter((item): item is string => typeof item === "string") : [];
  const versionCli = piCliInvocation(["--version"]);
  const piVersion = parsePiVersion((await run(versionCli.command, versionCli.args, undefined, 10000)).stdout);
  const notes: string[] = [];
  for (const spec of packages) {
    const name = npmPackageName(spec);
    if (!name) {
      const note = nonNpmPackageNote(dir, spec);
      if (note) notes.push(note);
      continue;
    }
    const current = installedVersion(dir, name);
    if (!current) {
      notes.push(`skipped ${name}; not installed`);
      continue;
    }
    if (!plannotatorUpdateAllowed(name, piVersion)) {
      notes.push(`held ${name}; Pi ${piVersion ?? "unknown"} is below 0.79.1`);
      continue;
    }
    const viewed = await run("npm", ["view", name, "version"], undefined, 15000);
    const latest = viewed.stdout.trim().replaceAll('"', "");
    const decision = classifyNpmUpdate(current, latest, name);
    if (decision === "current") continue;
    if (decision === "skip-major") {
      notes.push(`held ${name} ${current} -> ${latest}; major updates are not applied automatically`);
      continue;
    }
    if (decision === "skip-patch-pin") {
      notes.push(`held ${name} at ${current}; ${latest} would drop the patched pin ${PATCH_PINS[name]}`);
      continue;
    }
    const installCli = piCliInvocation(["install", `npm:${name}@${latest}`]);
    const installed = await run(installCli.command, installCli.args, dir, 60000);
    const after = installedVersion(dir, name);
    if (installed.code !== 0 || after !== latest) {
      const revertCli = piCliInvocation(["install", `npm:${name}@${current}`]);
      await run(revertCli.command, revertCli.args, dir, 60000);
      notes.push(`reverted ${name}; update to ${latest} did not install cleanly`);
      continue;
    }
    notes.push(`updated ${name} ${current} -> ${latest}`);
  }
  return notes;
}

export async function runLaunchUpdate(options: { skipNetwork?: boolean; skipTests?: boolean } = {}): Promise<string[]> {
  if (isSubagentSession()) return ["skipped launch update in a subagent"];
  const dir = agentDir();
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, "ultimate-pi-launch.lock");
  if (existsSync(lock)) {
    const age = Date.now() - statSync(lock).mtimeMs;
    if (age < 10 * 60 * 1000 && lockHolderAlive(lock)) return ["update already running"];
  }
  writeFileSync(lock, String(process.pid));
  try {
    const notes = [await syncSource(dir, { skipTests: options.skipTests === true })];
    if (!options.skipNetwork) {
      const statePath = join(dir, "ultimate-pi-launch.json");
      const state = readJson(statePath);
      if (npmCheckDue(state?.checkedAt)) {
        notes.push(...(await updateNpmPackages(dir)));
        const current = readJson(statePath) ?? {};
        writeFileSync(statePath, `${JSON.stringify({ ...current, checkedAt: new Date().toISOString() }, null, 2)}\n`);
      }
    }
    return notes.filter((note) => note.length > 0);
  } finally {
    try {
      unlinkSync(lock);
    } catch {
      // another launch already cleared it
    }
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isDirectRun()) {
  const skipNetwork = process.argv.includes("--sync-only");
  const notes = await runLaunchUpdate({ skipNetwork, skipTests: process.argv.includes("--skip-tests") });
  process.stdout.write(`${notes.join("\n")}\n`);
}
