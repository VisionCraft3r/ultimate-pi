import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const MIN_NODE = { major: 22, minor: 19, patch: 0 };

function mark(ok, label, detail = "") {
  const icon = ok ? "✔" : "✖";
  const suffix = detail ? ` — ${detail}` : "";
  console.log(`${icon} ${label}${suffix}`);
}

function parseSemver(version) {
  const m = String(version).trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function cmpSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function formatMinNode() {
  return `${MIN_NODE.major}.${MIN_NODE.minor}.${MIN_NODE.patch}`;
}

function detectPlatform() {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "linux") return "linux";
  return "other";
}

function whichOnPath(bin) {
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const names =
    process.platform === "win32" ? [`${bin}.exe`, `${bin}.cmd`, bin] : [bin];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function runHelp(binPath) {
  try {
    const output = execFileSync(binPath, ["--help"], {
      encoding: "utf8",
      timeout: 8000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output: String(output) };
  } catch (err) {
    const stdout = err?.stdout ? String(err.stdout) : "";
    const stderr = err?.stderr ? String(err.stderr) : "";
    const output = stdout || stderr || err?.message || String(err);
    return { ok: Boolean(stdout || stderr), output };
  }
}

function resolveAgentDir(options = {}) {
  if (options.agentDir) return path.resolve(options.agentDir);
  if (process.env.PI_CODING_AGENT_DIR) {
    return path.resolve(process.env.PI_CODING_AGENT_DIR);
  }
  return path.join(os.homedir(), ".pi", "agent");
}

function checkNode() {
  const parsed = parseSemver(process.version);
  const ok = parsed ? cmpSemver(parsed, MIN_NODE) >= 0 : false;
  mark(ok, `Node.js ${process.version}`, ok ? "meets minimum" : `need >= ${formatMinNode()}`);
  return {
    ok,
    version: process.version,
    minimum: formatMinNode(),
  };
}

function checkPi() {
  const binPath = whichOnPath("pi");
  if (!binPath) {
    mark(false, "pi binary on PATH", "not found");
    return { ok: false, binPath: null, help: "" };
  }
  const help = runHelp(binPath);
  mark(help.ok, "pi binary on PATH", binPath);
  return { ok: help.ok, binPath, help: help.output };
}

function checkTmux() {
  const binPath = whichOnPath("tmux");
  const ok = Boolean(binPath);
  mark(ok, "tmux present", ok ? binPath : "required by pi-interactive-subagents");
  return { ok, binPath };
}

function checkPlatform() {
  const platform = detectPlatform();
  const ok = platform === "darwin" || platform === "linux";
  mark(ok, `platform ${platform}`, process.platform);
  return { ok, platform, raw: process.platform };
}

function ensureAgentDir(options = {}) {
  const agentDir = resolveAgentDir(options);
  const existed = existsSync(agentDir);
  let created = false;
  if (!existed) {
    if (options.dryRun) {
      mark(true, "agent dir", `${agentDir} (would create; dry-run)`);
    } else {
      mkdirSync(agentDir, { recursive: true });
      created = true;
      mark(true, "agent dir", `${agentDir} (created)`);
    }
  } else {
    mark(true, "agent dir", agentDir);
  }
  return { ok: true, agentDir, existed, created };
}

/**
 * Preflight checks for the ultimate-pi installer.
 * @param {object} options
 * @param {string} [options.agentDir]
 * @param {boolean} [options.dryRun]
 * @returns {{
 *   ok: boolean,
 *   node: object,
 *   pi: object,
 *   tmux: object,
 *   platform: object,
 *   agentDir: object,
 * }}
 */
export function preflight(options = {}) {
  const node = checkNode();
  const pi = checkPi();
  const tmux = checkTmux();
  const platform = checkPlatform();
  const agentDir = ensureAgentDir(options);

  const ok = node.ok && pi.ok && tmux.ok && platform.ok && agentDir.ok;
  mark(ok, "preflight", ok ? "ready" : "failed");

  return { ok, node, pi, tmux, platform, agentDir };
}

export { resolveAgentDir, MIN_NODE, checkNode, checkPi, checkTmux, checkPlatform };
