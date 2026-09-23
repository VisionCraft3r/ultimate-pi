import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { preflight } from "./preflight.mjs";
import { collectProviders } from "./providers.mjs";
import { assignAgentModels } from "./agents.mjs";
import { configureFallbacks } from "./fallbacks.mjs";
import { configurePackagesAndKeys } from "./packages.mjs";
import { mergeCredentials } from "./auth-store.mjs";
import { applySettings } from "./settings.mjs";
import { configureExtras } from "./extras.mjs";
import { doctor } from "./doctor.mjs";
import { loadAnswers as loadAnswersFile } from "./answers.mjs";
import { bindAgentDir } from "./pi-runtime.mjs";
import { loadInstalledState } from "./load-installed-state.mjs";
import { createBackupSession } from "./backup.mjs";
import {
  removeManagedAgentsBlock,
  removeManagedAgentProfiles,
} from "./uninstall-managed.mjs";
import {
  removeUltimatePiPackage,
  runPiRemove,
} from "./uninstall-package.mjs";
import { AGENT_NAMES, assignmentModelRef } from "./schema.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function log(options, message) {
  if (options.dryRun) console.log(`[dry-run] ${message}`);
  else console.log(message);
}

async function resolveOptions(rawOptions) {
  const options = { ...rawOptions, repoRoot: REPO_ROOT };
  bindAgentDir(options);
  if (options.answersPath) {
    options.answers = await loadAnswersFile(options.answersPath);
  }
  return options;
}

async function welcome(options) {
  try {
    const logo = await readFile(join(REPO_ROOT, "assets", "logo.txt"), "utf8");
    console.log(logo.trimEnd());
  } catch {
    console.log("Ultimate Pi — Multi-agent routing for the Pi CLI.");
  }
  log(
    options,
    `Will configure agent dir: ${options.agentDir}\nWrites: auth.json, settings.json, agents/, AGENTS.md, model-agents.json (timestamped backups first).`,
  );
}

export async function install(rawOptions) {
  const options = await resolveOptions(rawOptions);
  await welcome(options);

  const preflightReport = preflight(options);
  if (!preflightReport.ok && !options.dryRun) {
    console.error("Preflight failed — fix the ✖ items above and re-run.");
    return 1;
  }

  const { providers } = await collectProviders(options);
  const agentAssignments = await assignAgentModels(options, providers);
  const { providerChains, agentFallbacks } = await configureFallbacks(options, providers, agentAssignments);
  const { keys, jev, memory, packages } = await configurePackagesAndKeys(options, providers, agentAssignments);
  const { enabledExtras } = await configureExtras(options);

  const allProviders = [...providers, ...keys];
  const openrouterKey = keys.find((k) => k.id === "openrouter")?.credential;
  const deepseekKey = keys.find((k) => k.id === "deepseek")?.credential;

  if (!options.dryRun) {
    await mergeCredentials(options.agentDir, allProviders);
  }

  const allAnswers = {
    providers: allProviders,
    agentAssignments,
    providerChains,
    agentFallbacks,
    packages,
    openrouterKey,
    deepseekKey,
    extras: { enabledExtras },
  };
  await applySettings(options, allAnswers);

  log(options, "");
  log(options, `JEV: ${jev?.mode === "openrouter" ? "configured (OpenRouter)" : "heuristic fallback mode"}`);
  log(options, `Observational memory: ${memory?.enabled ? "configured (DeepSeek)" : "not installed"}`);
  log(options, `macOS extras enabled: ${enabledExtras.length ? enabledExtras.join(", ") : "(none)"}`);

  if (!options.dryRun) {
    const report = await doctor(options);
    if (!report.ok) {
      log(options, "\nSome doctor checks failed — see ✖ lines above. Fix and re-run `ultimate-pi doctor`.");
      return 1;
    }
  }

  log(options, "\nInstall complete. Re-run any step with: ultimate-pi setup <providers|agents|fallbacks|jev|memory|extras>");
  return 0;
}

const SETUP_TOPICS = new Set(["providers", "agents", "fallbacks", "jev", "memory", "extras"]);

export async function setup(rawOptions) {
  const options = await resolveOptions(rawOptions);
  if (!SETUP_TOPICS.has(options.setupTopic)) {
    console.error(`Unknown setup topic: ${options.setupTopic}. One of: ${[...SETUP_TOPICS].join(", ")}`);
    return 1;
  }

  const { providers } = await collectProviders(options);

  switch (options.setupTopic) {
    case "providers":
      break; // collectProviders() above already did the work
    case "agents": {
      const installed = await loadInstalledState(options.agentDir);
      const agentAssignments = await assignAgentModels(options, providers);
      await applySettings(options, {
        providers,
        agentAssignments,
        providerChains: installed.providerChains,
        agentFallbacks: installed.agentFallbacks,
        packages: installed.packages,
      });
      break;
    }
    case "fallbacks": {
      const installed = await loadInstalledState(options.agentDir);
      const missing = AGENT_NAMES.filter(
        (name) => !assignmentModelRef(installed.agentAssignments?.[name]),
      );
      if (missing.length > 0) {
        console.error(
          `No complete installed agent assignments (missing: ${missing.join(", ")}). ` +
            "Run `ultimate-pi install` or `ultimate-pi setup agents` first, then re-run `ultimate-pi setup fallbacks`.",
        );
        return 1;
      }
      const { providerChains, agentFallbacks } = await configureFallbacks(
        options,
        providers,
        installed.agentAssignments,
      );
      await applySettings(options, {
        providers,
        agentAssignments: installed.agentAssignments,
        providerChains,
        agentFallbacks,
        packages: installed.packages,
      });
      break;
    }
    case "jev":
    case "memory": {
      const { keys, jev, memory, packages } = await configurePackagesAndKeys(options, providers, {});
      const allProviders = [...providers, ...keys];
      if (!options.dryRun) await mergeCredentials(options.agentDir, allProviders);
      log(options, `JEV: ${jev?.mode === "openrouter" ? "configured" : "heuristic fallback mode"}`);
      log(options, `Observational memory: ${memory?.enabled ? "configured" : "not installed"}`);
      void packages;
      break;
    }
    case "extras": {
      await configureExtras(options);
      break;
    }
  }

  log(options, `Done: ultimate-pi setup ${options.setupTopic}`);
  return 0;
}

export async function runDoctor(rawOptions) {
  const options = await resolveOptions(rawOptions);
  const report = await doctor(options);
  return report.ok ? 0 : 1;
}

export async function uninstall(rawOptions) {
  const options = await resolveOptions(rawOptions);
  const managedOpts = { dryRun: Boolean(options.dryRun) };
  const backupSession = createBackupSession(options.agentDir);

  let packagePlan;
  try {
    // Validate settings before any managed-file deletion so malformed JSON cannot
    // leave a partial uninstall (AGENTS.md/profiles gone, packages still present).
    packagePlan = await removeUltimatePiPackage(options.agentDir, backupSession, {
      dryRun: true,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  }

  let block;
  let profiles;
  try {
    // Block first so malformed AGENTS.md markers abort before profile unlinks.
    block = await removeManagedAgentsBlock(options.agentDir, backupSession, managedOpts);
    profiles = await removeManagedAgentProfiles(options.agentDir, backupSession, managedOpts);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  }

  const verb = options.dryRun ? "Would remove" : "Removed";
  const profileCount = profiles.removed.length;
  const profileList = profileCount > 0 ? `: ${profiles.removed.join(", ")}` : "";
  log(
    options,
    block.removed
      ? `${verb} managed AGENTS.md block (user text outside markers kept).`
      : "No managed AGENTS.md block to remove.",
  );
  log(options, `${verb} ${profileCount} managed agent profile(s)${profileList}.`);
  log(options, "auth.json was not modified.");

  const plannedSelf = Array.isArray(packagePlan?.removed) ? packagePlan.removed : [];
  const plannedSelfList = plannedSelf.join(", ");

  if (options.dryRun) {
    log(
      options,
      plannedSelf.length > 0
        ? `Would remove Ultimate Pi self package spec(s) from settings.json: ${plannedSelfList}`
        : "No Ultimate Pi self package spec(s) in settings.json to remove.",
    );
  } else if (options.offline) {
    try {
      const packageResult = await removeUltimatePiPackage(options.agentDir, backupSession);
      const removed = Array.isArray(packageResult?.removed) ? packageResult.removed : [];
      log(
        options,
        removed.length > 0
          ? `Removed Ultimate Pi self package spec(s) from settings.json only: ${removed.join(", ")}`
          : "No Ultimate Pi self package spec(s) in settings.json to remove.",
      );
      log(options, "Physical Pi package removal skipped (offline).");
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      return 1;
    }
  } else {
    if (plannedSelf.length === 0) {
      log(options, "No Ultimate Pi self package spec(s) in settings.json to remove.");
    } else {
      try {
        await backupSession.backupIfExists("settings.json");
        for (const source of plannedSelf) {
          await runPiRemove(source, { agentDir: options.agentDir });
        }
        const replan = await removeUltimatePiPackage(options.agentDir, backupSession, {
          dryRun: true,
        });
        const remaining = Array.isArray(replan?.removed) ? replan.removed : [];
        if (remaining.length > 0) {
          console.error(
            `Partial uninstall: Ultimate Pi self package spec(s) still present: ${remaining.join(", ")}`,
          );
          return 1;
        }
        log(
          options,
          `Removed Ultimate Pi self package spec(s) via pi remove: ${plannedSelfList}`,
        );
      } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        console.error(
          "Partial uninstall: package removal failed. Managed files may already be removed; auth.json was not modified. This is not a full uninstall.",
        );
        return 1;
      }
    }
  }
  return 0;
}

export async function dispatch(options) {
  switch (options.command) {
    case "install":
      return install(options);
    case "setup":
      return setup(options);
    case "doctor":
      return runDoctor(options);
    case "uninstall":
      return uninstall(options);
    default:
      console.error(`Unknown command: ${options.command}`);
      return 1;
  }
}
