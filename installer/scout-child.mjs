import fs from "node:fs/promises";
import path from "node:path";

const LAUNCHER = path.join(
  "git",
  "github.com",
  "amosblomqvist",
  "pi-interactive-subagents",
  "pi-extension",
  "subagents",
  "index.ts",
);

const LOOP_NEEDLE = `    for (const extPath of extPaths) {
      parts.push("-e", shellEscape(extPath));
    }
  }
}`;

const LOOP_REPLACEMENT = `    for (const extPath of extPaths) {
      parts.push("-e", shellEscape(extPath));
    }
    if (loadout.agent === "scout") {
      parts.push("--no-lens-context");
      if (loadout.agentDir) {
        const scoutBudget = join(loadout.agentDir, "extensions", "scout-budget.ts");
        if (existsSync(scoutBudget)) parts.push("-e", shellEscape(scoutBudget));
      }
    }
  }
}`;

/**
 * Scout children skip pi-lens prompt injection and load the tool-round cap.
 * No-op when the sandbox loop is absent or the scout branch is already there.
 * @param {string} source
 */
export function ensureScoutChildLaunch(source) {
  if (source.includes('parts.push("--no-lens-context")') && source.includes("scout-budget.ts")) {
    return { status: "already-applied", source };
  }
  if (!source.includes(LOOP_NEEDLE)) {
    return { status: "skipped", reason: "subagent sandbox loop not found", source };
  }
  if (source.split(LOOP_NEEDLE).length !== 2) {
    return { status: "skipped", reason: "subagent sandbox loop is not unique", source };
  }
  return { status: "applied", source: source.replace(LOOP_NEEDLE, LOOP_REPLACEMENT) };
}

/** Apply the scout launch flags to the installed subagent launcher. */
export async function applyScoutChildLaunch(agentDir) {
  if (!agentDir) return { status: "skipped", reason: "no agent directory" };
  const target = path.join(agentDir, LAUNCHER);
  let source;
  try {
    source = await fs.readFile(target, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "skipped", reason: "subagent launcher not installed" };
    throw error;
  }
  const result = ensureScoutChildLaunch(source);
  if (result.status === "applied") await fs.writeFile(target, result.source);
  return { status: result.status, reason: result.reason, target };
}
