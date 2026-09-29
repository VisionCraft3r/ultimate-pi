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

const SCOUT_BLOCK = `    if (loadout.agent === "scout") {
      parts.push("--no-lens-context");
      if (loadout.agentDir) {
        const scoutBudget = join(loadout.agentDir, "extensions", "scout-budget.ts");
        if (existsSync(scoutBudget)) parts.push("-e", shellEscape(scoutBudget));
      }
    }`;

const QA_BLOCK = `    if (loadout.agent === "qa_tester") {
      if (loadout.agentDir) {
        const qaBudget = join(loadout.agentDir, "extensions", "qa-budget.ts");
        if (existsSync(qaBudget)) parts.push("-e", shellEscape(qaBudget));
      }
    }`;

const LOOP_REPLACEMENT = `    for (const extPath of extPaths) {
      parts.push("-e", shellEscape(extPath));
    }
${SCOUT_BLOCK}
${QA_BLOCK}
  }
}`;

const THINKING_NEEDLE = `    const model = loadout.thinking ? \`\${loadout.model}:\${loadout.thinking}\` : loadout.model;
    parts.push("--model", shellEscape(model));`;

const THINKING_REPLACEMENT = `    parts.push("--model", shellEscape(loadout.model));
    if (loadout.thinking) parts.push("--thinking", shellEscape(loadout.thinking));`;

const DIET_SIGNATURE =
  "export function contextExtensionsForChild(grantedTools: ReadonlySet<string>): { paths: string[]; tools: string[] } {";
const DIET_SIGNATURE_NEXT =
  "export function contextExtensionsForChild(grantedTools: ReadonlySet<string>, agent?: string): { paths: string[]; tools: string[] } {";

const DIET_PUSH = `    if (pkg.whenTools && !pkg.whenTools.some((tool) => grantedTools.has(tool))) continue;
    paths.push(...entries);
    tools.push(...pkg.tools);`;

const DIET_PUSH_NEXT = `    if (pkg.whenTools && !pkg.whenTools.some((tool) => grantedTools.has(tool))) continue;
    if (agent === "scout" && pkg.segments.at(-1) === "pi-lens") continue;
    paths.push(...entries);
    if (agent === "scout" && pkg.segments.at(-1) === "pi-graft") {
      tools.push("graft_find_code", "graft_repo_map");
    } else {
      tools.push(...pkg.tools);
    }`;

const DIET_CALL = "const context = contextExtensionsForChild(granted);";
const DIET_CALL_NEXT = "const context = contextExtensionsForChild(granted, loadout.agent);";

/**
 * Scout children skip pi-lens prompt injection and load the tool-round cap.
 * QA children load the same kind of cap. No-op when the sandbox loop is absent
 * or both branches are already there. A launcher that already has the scout
 * branch gains the QA branch.
 * @param {string} source
 */
export function ensureScoutChildLaunch(source) {
  const hasScout = source.includes('parts.push("--no-lens-context")') && source.includes("scout-budget.ts");
  const hasQa = source.includes("qa-budget.ts");
  if (hasScout && hasQa) return { status: "already-applied", source };
  if (hasScout) {
    if (!source.includes(SCOUT_BLOCK)) {
      return { status: "skipped", reason: "scout branch not in the expected shape", source };
    }
    if (source.split(SCOUT_BLOCK).length !== 2) {
      return { status: "skipped", reason: "scout branch is not unique", source };
    }
    return { status: "applied", source: source.replace(SCOUT_BLOCK, `${SCOUT_BLOCK}\n${QA_BLOCK}`) };
  }
  if (!source.includes(LOOP_NEEDLE)) {
    return { status: "skipped", reason: "subagent sandbox loop not found", source };
  }
  if (source.split(LOOP_NEEDLE).length !== 2) {
    return { status: "skipped", reason: "subagent sandbox loop is not unique", source };
  }
  return { status: "applied", source: source.replace(LOOP_NEEDLE, LOOP_REPLACEMENT) };
}

/**
 * Pass thinking as `--thinking`, not as a suffix on the model id.
 * A suffix makes the provider look up a model id that does not exist.
 * @param {string} source
 */
export function ensureSeparateThinkingFlag(source) {
  if (source.includes('parts.push("--thinking", shellEscape(loadout.thinking))')) {
    return { status: "already-applied", source };
  }
  if (!source.includes(THINKING_NEEDLE)) {
    return { status: "skipped", reason: "thinking suffix not found", source };
  }
  if (source.split(THINKING_NEEDLE).length !== 2) {
    return { status: "skipped", reason: "thinking suffix is not unique", source };
  }
  return { status: "applied", source: source.replace(THINKING_NEEDLE, THINKING_REPLACEMENT) };
}

/**
 * Scout keeps graft_find_code and graft_repo_map. The rest of pi-lens and pi-graft
 * stay off that child. Other roles are unchanged.
 * @param {string} source
 */
export function ensureScoutToolDiet(source) {
  const applied =
    source.includes('agent === "scout" && pkg.segments.at(-1) === "pi-lens"') &&
    source.includes("contextExtensionsForChild(granted, loadout.agent)");
  if (applied) return { status: "already-applied", source };
  if (!source.includes(DIET_SIGNATURE) || !source.includes(DIET_PUSH) || !source.includes(DIET_CALL)) {
    return { status: "skipped", reason: "child context hook not found", source };
  }
  if (
    source.split(DIET_SIGNATURE).length !== 2 ||
    source.split(DIET_PUSH).length !== 2 ||
    source.split(DIET_CALL).length !== 2
  ) {
    return { status: "skipped", reason: "child context hook is not unique", source };
  }
  return {
    status: "applied",
    source: source
      .replace(DIET_SIGNATURE, DIET_SIGNATURE_NEXT)
      .replace(DIET_PUSH, DIET_PUSH_NEXT)
      .replace(DIET_CALL, DIET_CALL_NEXT),
  };
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
  let sourceNext = source;
  let status = "already-applied";
  const reasons = [];
  for (const ensure of [ensureScoutChildLaunch, ensureSeparateThinkingFlag, ensureScoutToolDiet]) {
    const result = ensure(sourceNext);
    if (result.status === "applied") {
      sourceNext = result.source;
      status = "applied";
    } else if (result.status === "skipped") {
      reasons.push(result.reason);
    }
  }
  if (status === "applied") await fs.writeFile(target, sourceNext);
  if (status === "already-applied" && reasons.length > 0) {
    return { status: "skipped", reason: reasons.join("; "), target };
  }
  return { status, reason: reasons.length ? reasons.join("; ") : undefined, target };
}
