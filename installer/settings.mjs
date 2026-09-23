import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBackupSession } from "./backup.mjs";
import { renderAgentTemplates } from "./render-agents.mjs";
import {
  AGENT_NAMES,
  assignmentModelRef,
  collectEnabledModels,
  formatModelRef,
  modelForProviderFromAssignments,
  normalizeAgentFallbacks,
  normalizeFallbacksMap,
} from "./schema.mjs";
import { writeModelConfig } from "./write-model-config.mjs";

const SETTINGS_FILE = "settings.json";
const AGENTS_MD_FILE = "AGENTS.md";
const BEGIN_MARKER = "<!-- ultimate-pi:begin -->";
const END_MARKER = "<!-- ultimate-pi:end -->";

function settingsPath(agentDir) {
  return path.join(agentDir, SETTINGS_FILE);
}

function agentsMdPath(agentDir) {
  return path.join(agentDir, AGENTS_MD_FILE);
}

function defaultAgentsMdTemplatePath() {
  return fileURLToPath(new URL("../templates/AGENTS.md.tmpl", import.meta.url));
}

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

/** Shallow-merge arrays by de-duped union, objects recursively, scalars overwritten by `patch`. */
function deepMergePreserving(base, patch) {
  if (Array.isArray(base) && Array.isArray(patch)) {
    const merged = [...base];
    for (const entry of patch) {
      const exists = merged.some((existing) => JSON.stringify(existing) === JSON.stringify(entry));
      if (!exists) merged.push(entry);
    }
    return merged;
  }
  if (base && patch && typeof base === "object" && typeof patch === "object" && !Array.isArray(base)) {
    const out = { ...base };
    for (const [key, value] of Object.entries(patch)) {
      out[key] = key in base ? deepMergePreserving(base[key], value) : value;
    }
    return out;
  }
  return patch;
}

/**
 * Merge ultimate-pi's install output into <agentDir>/settings.json without
 * clobbering any existing, unrelated settings. Only touches:
 *   - packages (union of ids)
 *   - enabledModels (union of "provider/id" strings)
 *   - observational-memory.models.{observer,consolidator} (if DeepSeek configured)
 */
export async function mergeSettings(agentDir, patch) {
  const file = settingsPath(agentDir);
  const existing = await readJson(file, {});
  const next = deepMergePreserving(existing, patch);
  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function renderTemplate(template, data) {
  // Minimal, dependency-free {{#each x}}...{{/each}} + {{field}} renderer —
  // just enough for templates/AGENTS.md.tmpl, not a general template engine.
  let out = template.replace(/\{\{#each (\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_m, key, block) => {
    const items = data[key];
    if (!Array.isArray(items) || items.length === 0) return "";
    return items
      .map((item) => block.replace(/\{\{(\w+)\}\}/g, (_m2, field) => String(item[field] ?? "")))
      .join("");
  });
  out = out.replace(/\{\{(\w+)\}\}/g, (_m, field) => String(data[field] ?? ""));
  return out;
}

function formatChain(chain) {
  if (!Array.isArray(chain) || chain.length === 0) return "";
  return chain.map((hop) => formatModelRef(hop)).filter(Boolean).join(", ");
}

function requireAgentAssignments(assignments) {
  for (const name of AGENT_NAMES) {
    if (!assignmentModelRef(assignments?.[name])) {
      throw new Error(
        `missing assignment for agent "${name}": expected { provider, model } so model: is provider/id`,
      );
    }
  }
}

/**
 * Idempotently splice the rendered AGENTS.md.tmpl block into
 * <agentDir>/AGENTS.md between the ultimate-pi begin/end markers. Creates
 * the markers (appending to the end of the file) if they don't exist yet.
 * Content outside the markers — the user's own notes — is left untouched.
 */
export async function applyAgentsMdBlock(agentDir, templatePath, data) {
  const template = await fs.readFile(templatePath, "utf8");
  const rendered = renderTemplate(template, data).trim();

  const file = agentsMdPath(agentDir);
  const text = await fs.readFile(file, "utf8").catch((err) => {
    if (err.code === "ENOENT") return "";
    throw err;
  });

  const start = text.indexOf(BEGIN_MARKER);
  const end = text.indexOf(END_MARKER);

  let next;
  if (start >= 0 && end >= 0 && end > start) {
    next = text.slice(0, start) + rendered + text.slice(end + END_MARKER.length);
  } else {
    const sep = text.trim().length > 0 ? "\n\n" : "";
    next = `${text}${sep}${rendered}\n`;
  }

  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(file, next, "utf8");
  return next;
}

/**
 * Apply the full settings step: merge settings.json, write model-agents.json,
 * render templates/agents/*.md, and splice the AGENTS.md marker block.
 * --dry-run computes the patch and template data but writes nothing.
 */
export async function applySettings(options, allAnswers) {
  const agentDir = options.agentDir;
  const templatePath = options.agentsMdTemplatePath ?? defaultAgentsMdTemplatePath();
  const assignments = allAnswers.agentAssignments ?? {};
  requireAgentAssignments(assignments);

  const lookup = modelForProviderFromAssignments(assignments);
  const providerChains = normalizeFallbacksMap(allAnswers.providerChains, lookup);
  const agentFallbacks = normalizeAgentFallbacks(allAnswers.agentFallbacks, lookup);
  const enabledModels = collectEnabledModels(allAnswers);

  const packages = allAnswers.packages ?? [];
  const patch = { packages, enabledModels };
  if (allAnswers.deepseekKey) {
    patch["observational-memory"] = {
      models: { observer: "deepseek/deepseek-flash", consolidator: "deepseek/deepseek-flash" },
    };
  }

  const templateData = {
    agents: Object.entries(assignments).map(([name, assignment]) => ({
      name,
      model: formatModelRef(assignmentModelRef(assignment)) || "(unset)",
      fallbackChain: formatChain(agentFallbacks[name]) || "(uses global chain)",
    })),
    providers: (allAnswers.providers ?? []).map((p) => ({ id: p.id, authMethod: p.authMethod })),
    providerChains: Object.entries(providerChains).map(([provider, chain]) => ({
      provider,
      chain: formatChain(chain) || "(none)",
    })),
    jevStatus: allAnswers.openrouterKey ? "configured" : "not configured (heuristic fallback mode)",
    memoryStatus: allAnswers.deepseekKey ? "configured" : "not installed",
  };

  let modelAgents;
  let agentFiles;
  if (!options.dryRun) {
    const backupSession = options.backupSession ?? createBackupSession(agentDir);
    await backupSession.backupIfExists(SETTINGS_FILE);
    await mergeSettings(agentDir, patch);
    await backupSession.backupIfExists(AGENTS_MD_FILE);
    await applyAgentsMdBlock(agentDir, templatePath, templateData);
    modelAgents = await writeModelConfig(agentDir, providerChains, agentFallbacks, backupSession);
    agentFiles = await renderAgentTemplates(agentDir, assignments, backupSession, {
      overwriteUnmarked: options.overwriteUnmarked,
      override: options.override,
    });
  }

  return { patch, templateData, modelAgents, agentFiles };
}
