import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_NAMES,
  MANAGED_AGENT_MARKER,
  PROVIDER_LABELS,
  assignmentModelRef,
  formatModelRef,
} from "./schema.mjs";

const DEFAULT_THINKING = "medium";

function templatesDir() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "templates", "agents");
}

function valuesFor(name, assignments) {
  const row = assignments?.[name];
  const ref = assignmentModelRef(row);
  const model = formatModelRef(ref);
  if (!ref || !model) {
    throw new Error(
      `missing assignment for agent "${name}": expected { provider, model } so model: is provider/id`,
    );
  }
  const thinking =
    typeof row.thinking === "string" && row.thinking.trim()
      ? row.thinking.trim()
      : DEFAULT_THINKING;
  return {
    model,
    thinking,
    providerLabel: PROVIDER_LABELS[ref.provider] ?? ref.provider,
  };
}

function renderTemplate(template, values) {
  return template.replace(/\{\{(model|thinking|providerLabel)\}\}/g, (_m, key) => values[key]);
}

async function readIfExists(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return undefined;
    throw err;
  }
}

async function writeRendered(agentDir, relativePath, body, backupSession) {
  const dest = path.join(agentDir, relativePath);
  if (backupSession?.backupIfExists) {
    await backupSession.backupIfExists(relativePath);
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, body, "utf8");
  return dest;
}

/**
 * Render templates/agents/*.md into <agentDir>/agents/<name>.md.
 * Unmarked existing files are left alone; a <name>.ultimate-pi.md sidecar is
 * written instead unless options.overwriteUnmarked / options.override is set.
 */
export async function renderAgentTemplates(
  agentDir,
  assignments,
  backupSession,
  options = {},
) {
  const overwriteUnmarked = Boolean(options.overwriteUnmarked || options.override);
  const planned = [];
  for (const name of AGENT_NAMES) {
    const file = path.join(templatesDir(), `${name}.md`);
    let template;
    try {
      template = await fs.readFile(file, "utf8");
    } catch (err) {
      if (err.code === "ENOENT") throw new Error(`missing agent template: ${file}`);
      throw err;
    }
    planned.push({ name, body: renderTemplate(template, valuesFor(name, assignments)) });
  }

  const results = [];
  for (const { name, body } of planned) {
    const destRel = path.join("agents", `${name}.md`);
    const existing = await readIfExists(path.join(agentDir, destRel));
    const managed = existing?.includes(MANAGED_AGENT_MARKER) === true;
    const unmarked = existing !== undefined && !managed;

    if (unmarked && !overwriteUnmarked) {
      const sidecarRel = path.join("agents", `${name}.ultimate-pi.md`);
      await writeRendered(agentDir, sidecarRel, body, backupSession);
      results.push({ name, relativePath: sidecarRel, action: "sidecar" });
      continue;
    }

    const action = existing === undefined ? "created" : "replaced";
    if (managed || (unmarked && overwriteUnmarked)) {
      await writeRendered(agentDir, destRel, body, backupSession);
    } else {
      await writeRendered(agentDir, destRel, body, undefined);
    }
    results.push({ name, relativePath: destRel, action });
  }
  return results;
}
