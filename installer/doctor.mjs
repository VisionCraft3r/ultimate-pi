import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkNode, checkPi, checkTmux, resolveAgentDir } from "./preflight.mjs";
import { readAuth } from "./auth-store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELF_GIT_REPO = "github.com/VisionCraft3r/ultimate-pi";
const SUBAGENTS_GIT_REPO = "github.com/amosblomqvist/pi-interactive-subagents";

function mark(ok, label, detail = "") {
  const icon = ok ? "✔" : "✖";
  const suffix = detail ? ` — ${detail}` : "";
  console.log(`${icon} ${label}${suffix}`);
  return { ok, label, detail };
}

async function readJsonSafe(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

async function checkProviders(agentDir) {
  const auth = await readAuth(agentDir);
  const providerIds = Object.keys(auth ?? {});
  if (providerIds.length === 0) {
    return mark(
      false,
      "provider auth",
      "no providers configured — run `pi login` for your OAuth provider first, then re-run install (or `ultimate-pi setup providers`)",
    );
  }
  return mark(true, "provider auth", providerIds.join(", "));
}

function packageSource(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && typeof entry.source === "string") return entry.source;
  return "";
}

function npmPackageName(spec) {
  if (!spec.startsWith("npm:")) return "";
  const rest = spec.slice(4);
  if (rest.startsWith("@")) {
    const match = rest.match(/^(@[^/]+\/[^@]+)(?:@.+)?$/);
    return match ? match[1] : rest;
  }
  const at = rest.indexOf("@");
  return at >= 0 ? rest.slice(0, at) : rest;
}

function gitRepo(spec) {
  let value = spec.trim();
  if (value.startsWith("git:")) value = value.slice(4);
  if (value.startsWith("git@github.com:")) value = `github.com/${value.slice("git@github.com:".length)}`;
  value = value.replace(/^https?:\/\//, "").replace(/^ssh:\/\/git@/, "").replace(/\.git$/, "");
  const slash = value.lastIndexOf("/");
  const at = value.lastIndexOf("@");
  if (at > slash) value = value.slice(0, at);
  return value.replace(/\/+$/, "");
}

function isSelfSource(spec) {
  if (gitRepo(spec) === SELF_GIT_REPO) return true;
  if (path.isAbsolute(spec) && path.resolve(spec) === ROOT) return true;
  return false;
}

function gitInstallPath(agentDir, repo) {
  return path.join(agentDir, "git", ...repo.split("/").filter(Boolean));
}

function physicallyInstalled(agentDir, kind, matchedSources) {
  if (kind === "self") {
    return matchedSources.some((spec) => {
      if (path.isAbsolute(spec)) return existsSync(path.resolve(spec));
      return existsSync(gitInstallPath(agentDir, SELF_GIT_REPO));
    });
  }
  if (kind === "git:github.com/amosblomqvist/pi-interactive-subagents") {
    return existsSync(gitInstallPath(agentDir, SUBAGENTS_GIT_REPO));
  }
  if (kind === "npm:pi-lens") return existsSync(path.join(agentDir, "npm", "node_modules", "pi-lens"));
  if (kind === "npm:pi-graft") return existsSync(path.join(agentDir, "npm", "node_modules", "pi-graft"));
  return false;
}

async function checkRequiredPackages(agentDir, options = {}) {
  const settings = await readJsonSafe(path.join(agentDir, "settings.json"));
  const packages = Array.isArray(settings?.packages) ? settings.packages : [];
  const sources = packages.map(packageSource).filter(Boolean);

  const required = [
    { id: "self", match: isSelfSource },
    { id: "git:github.com/amosblomqvist/pi-interactive-subagents", match: (spec) => gitRepo(spec) === SUBAGENTS_GIT_REPO },
    { id: "npm:pi-lens", match: (spec) => npmPackageName(spec) === "pi-lens" },
    { id: "npm:pi-graft", match: (spec) => npmPackageName(spec) === "pi-graft" },
  ];

  const missingSettings = [];
  const missingInstall = [];
  for (const req of required) {
    const matched = sources.filter((spec) => req.match(spec));
    if (matched.length === 0) {
      missingSettings.push(req.id);
      continue;
    }
    if (!options.offline && !physicallyInstalled(agentDir, req.id, matched)) {
      missingInstall.push(req.id);
    }
  }

  const problems = [
    ...missingSettings.map((id) => `${id} missing from settings.json`),
    ...missingInstall.map((id) => `${id} listed but not installed`),
  ];
  const ok = problems.length === 0;
  const detail = ok
    ? options.offline
      ? "settings.json lists self, interactive-subagents, npm:pi-lens, npm:pi-graft"
      : "required packages present in settings.json and installed"
    : problems.join("; ");
  return mark(ok, "required packages", detail);
}

function collectProviderIds(chain) {
  if (!Array.isArray(chain)) return [];
  return chain
    .map((entry) => (entry && typeof entry === "object" ? entry.provider : undefined))
    .filter((id) => typeof id === "string" && id.length > 0);
}

async function checkFallbackConfig(agentDir, configuredProviders) {
  const file = path.join(agentDir, "model-agents.json");
  if (!existsSync(file)) {
    return mark(true, "fallback config", "no model-agents.json yet (defaults will be used)");
  }
  const data = await readJsonSafe(file);
  if (data === undefined) {
    return mark(false, "fallback config", `${file} does not parse as JSON`);
  }
  const referenced = new Set();
  for (const chain of Object.values(data.fallbacks ?? {})) {
    for (const id of collectProviderIds(chain)) referenced.add(id);
  }
  for (const chain of Object.values(data.agentFallbacks ?? {})) {
    for (const id of collectProviderIds(chain)) referenced.add(id);
  }
  const known = new Set(configuredProviders);
  const unknown = [...referenced].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    return mark(
      false,
      "fallback config",
      `references provider(s) with no credentials: ${unknown.join(", ")}`,
    );
  }
  return mark(true, "fallback config", "model-agents.json parses and all referenced providers are configured");
}

/**
 * Post-install health check. Prints ✔/✖ lines and returns a summary object.
 * @param {object} options
 * @param {string} [options.agentDir]
 * @param {boolean} [options.offline] - skip any network-reaching checks
 * @returns {Promise<{ ok: boolean, checks: object[] }>}
 */
export async function doctor(options = {}) {
  const agentDir = resolveAgentDir(options);
  const checks = [];

  checks.push(checkNode());
  checks.push(checkTmux());

  const piCheck = options.offline
    ? mark(true, "pi binary on PATH", "skipped (offline)")
    : checkPi();
  checks.push(piCheck);

  const auth = await readAuth(agentDir).catch(() => ({}));
  checks.push(await checkProviders(agentDir));
  checks.push(await checkRequiredPackages(agentDir, options));
  checks.push(await checkFallbackConfig(agentDir, Object.keys(auth ?? {})));

  const ok = checks.every((check) => check.ok);
  mark(ok, "doctor", ok ? "all checks passed" : "one or more checks failed");

  return { ok, checks };
}
