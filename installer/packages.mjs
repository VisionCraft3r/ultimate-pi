import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as p from "@clack/prompts";
import { createBackupSession } from "./backup.mjs";
import { DEPENDENCY_PATCHES, applyDependencyPatch } from "./dependency-patches.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const OPTIONAL_PACKAGES = [
  { value: "npm:@plannotator/pi-extension", label: "plannotator (@plannotator/pi-extension)" },
  { value: "npm:pi-cache-graph", label: "pi-cache-graph" },
];

const REQUIRED_PACKAGES = [
  "git:github.com/amosblomqvist/pi-interactive-subagents@c3e8b53c0754ae5ccc19fdab5a7481ec039bc2f7",
  "npm:pi-lens",
  "npm:pi-graft",
];

function isCancelled(value) {
  if (p.isCancel(value)) {
    p.cancel("Package setup cancelled.");
    process.exit(0);
  }
  return value;
}

function providerIds(providers) {
  return (providers ?? []).map((entry) => (typeof entry === "string" ? entry : entry.id));
}

function existingCredential(providers, id) {
  const row = (providers ?? []).find((entry) => entry?.id === id);
  return row?.credential || "";
}

function selfSpec(options = {}) {
  // `--local` selects Pi settings scope, not a package source. A Git checkout is
  // stable; an npx/npm-extracted directory is disposable, so install from Git.
  if (options.published || !existsSync(path.join(ROOT, ".git"))) {
    return "git:github.com/VisionCraft3r/ultimate-pi";
  }
  return ROOT;
}

function isDocumentedPiSource(spec) {
  if (typeof spec !== "string") return false;
  const value = spec.trim();
  if (!value) return false;
  if (value.startsWith("npm:") && value.length > 4) return true;
  if (value.startsWith("git:") && value.length > 4) return true;
  if (value.startsWith("https://") && value.length > "https://".length) return true;
  if (value.startsWith("ssh://") && value.length > "ssh://".length) return true;
  if (path.isAbsolute(value)) return true;
  if (value === "." || value === "..") return true;
  if (value.startsWith("./") || value.startsWith("../")) return true;
  return false;
}

function assertAnswerPackageSources(entries) {
  const invalid = entries.filter((spec) => !isDocumentedPiSource(spec));
  if (invalid.length === 0) return;
  const listed = invalid.map((spec) => JSON.stringify(spec)).join(", ");
  throw new Error(
    `answers.packages must use documented Pi source specs (npm:, git:, https://, ssh://, or an absolute/relative local path). Rejected bare or undocumented name(s) before pi install: ${listed}`,
  );
}

function isGitSource(spec) {
  return typeof spec === "string" && spec.startsWith("git:");
}

export function gitSourceSpecs(specs) {
  return [...new Set((specs ?? []).filter(isGitSource))];
}

function gitIsAvailable() {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function gitMissingMessage(gitSpecs) {
  const listed = gitSpecs.join(", ");
  const hasRequired = gitSpecs.some(
    (spec) =>
      spec.startsWith("git:github.com/amosblomqvist/pi-interactive-subagents") ||
      spec.startsWith("git:github.com/VisionCraft3r/ultimate-pi"),
  );
  if (hasRequired) {
    return (
      `git is required for git-based package(s): ${listed}. Install git and re-run. ` +
      "Optional git packages (for example observational memory) can be omitted from answers.packages, " +
      "but required packages such as pi-interactive-subagents cannot be skipped."
    );
  }
  return (
    `git is required for optional git-based package(s): ${listed}. Install git and re-run, ` +
    "or omit these from answers.packages / skip observational memory."
  );
}

/** Fail before `pi install` of any git: spec when `git` is not on PATH. */
export function assertGitAvailableForSpecs(specs, options = {}, isAvailable = gitIsAvailable) {
  if (options.dryRun || options.offline) return;
  const gitSpecs = gitSourceSpecs(specs);
  if (gitSpecs.length === 0) return;
  if (isAvailable()) return;
  throw new Error(gitMissingMessage(gitSpecs));
}

function runPiInstall(spec) {
  return new Promise((resolve, reject) => {
    const child = spawn("pi", ["install", spec], { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pi install ${spec} exited ${code}`));
    });
  });
}

async function installSpec(spec, options) {
  if (options.dryRun || options.offline) {
    p.log.info(`[${options.offline ? "offline" : "dry-run"}] pi install ${spec}`);
    return;
  }
  p.log.info(`pi install ${spec}`);
  await runPiInstall(spec);
}

async function promptOptionalKey(message) {
  const value = isCancelled(
    await p.password({
      message,
      mask: "•",
    }),
  );
  return (value ?? "").trim();
}

/**
 * JEV + observational-memory keys, optional third-party packages, `pi install`.
 */
export async function configurePackagesAndKeys(
  options = {},
  providers = [],
  _agentAssignments = {},
) {
  const answers = options.answers ?? {};
  const ids = providerIds(providers);
  const keys = [];
  if (Array.isArray(answers.packages)) {
    assertAnswerPackageSources(answers.packages);
  }

  p.note(
    [
      "JEV (triage/sentinel) routes overflow and 429s through OpenRouter so a",
      "cheap sentinel can pick a fallback model instead of dying on quota.",
      "Without an OpenRouter key, JEV stays in heuristic fallback mode.",
      "You can add a key later with: ultimate-pi setup jev",
    ].join("\n"),
    "JEV / OpenRouter routing",
  );

  let openrouterKey =
    answers.openrouterKey ?? existingCredential(providers, "openrouter");
  if (!openrouterKey && !options.yes && !options.dryRun) {
    openrouterKey = await promptOptionalKey(
      "OpenRouter API key for JEV (Enter to skip)",
    );
  }
  if (openrouterKey) {
    keys.push({ id: "openrouter", authMethod: "api-key", credential: openrouterKey });
  } else {
    p.log.info("Skipping OpenRouter key — JEV will use heuristic fallback mode.");
    p.log.info("Configure later with: ultimate-pi setup jev");
  }

  p.note(
    [
      "Observational memory is a lightweight observer/consolidator: it records",
      "session notes and consolidates them later. It is not a heavy memory stack.",
      "It needs a DeepSeek key to install/enable. Skip to leave it off.",
      "You can enable it later with: ultimate-pi setup memory",
    ].join("\n"),
    "Observational memory / DeepSeek",
  );

  let deepseekKey = answers.deepseekKey ?? existingCredential(providers, "deepseek");
  if (!deepseekKey && !options.yes && !options.dryRun) {
    deepseekKey = await promptOptionalKey(
      "DeepSeek API key for observational memory (Enter to skip)",
    );
  }
  if (deepseekKey) {
    keys.push({ id: "deepseek", authMethod: "api-key", credential: deepseekKey });
  } else {
    p.log.info("Skipping DeepSeek key — observational memory will not be installed.");
    p.log.info("Configure later with: ultimate-pi setup memory");
  }

  let optionalChosen = OPTIONAL_PACKAGES.map((pkg) => pkg.value);
  if (Array.isArray(answers.packages)) {
    optionalChosen = answers.packages;
  } else if (!options.yes && !options.dryRun) {
    optionalChosen = isCancelled(
      await p.multiselect({
        message: "Optional third-party packages (default: all)",
        options: OPTIONAL_PACKAGES,
        initialValues: optionalChosen,
        required: false,
      }),
    );
  }

  const packages = [selfSpec(options), ...REQUIRED_PACKAGES, ...optionalChosen];
  if (deepseekKey) packages.push("git:github.com/amosblomqvist/pi-observational-memory");
  if (ids.includes("anthropic")) packages.push("npm:@gotgenes/pi-anthropic-auth");
  if (ids.includes("cursor")) packages.push("npm:@schultzp2020/pi-cursor");

  const unique = [...new Set(packages)];
  assertGitAvailableForSpecs(unique, options);
  for (const spec of unique) {
    await installSpec(spec, options);
  }

  const patchResults = [];
  if (!options.offline && !options.dryRun) {
    const backupSession = options.backupSession ?? createBackupSession(options.agentDir);
    for (const descriptor of DEPENDENCY_PATCHES) {
      const selected = descriptor.name === "pi-interactive-subagents"
        ? unique.some((spec) => spec.startsWith("git:github.com/amosblomqvist/pi-interactive-subagents"))
        : unique.includes("npm:@schultzp2020/pi-cursor");
      if (!selected) continue;
      const result = await applyDependencyPatch(options.agentDir, descriptor, backupSession, options);
      patchResults.push({ name: descriptor.name, status: result.status, reason: result.reason });
      if (result.status === "skipped") {
        p.log.warn(`Dependency patch skipped for ${descriptor.name}: ${result.reason}`);
      } else {
        p.log.info(`Dependency patch ${descriptor.name}: ${result.status}`);
      }
    }
  }

  return {
    patchResults,
    keys,
    jev: { enabled: true, mode: openrouterKey ? "openrouter" : "heuristic" },
    memory: { enabled: Boolean(deepseekKey) },
    packages: unique,
  };
}
