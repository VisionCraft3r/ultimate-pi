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
      if (loadout.agentDir) {
        const scoutBudget = join(loadout.agentDir, "extensions", "scout-budget.ts");
        if (existsSync(scoutBudget)) parts.push("-e", shellEscape(scoutBudget));
      }
    }`;

const LENS_FLAG_LINE = `      parts.push("--no-lens-context");\n`;

const QA_BLOCK = `    if (loadout.agent === "qa_tester") {
      if (loadout.agentDir) {
        const qaBudget = join(loadout.agentDir, "extensions", "qa-budget.ts");
        if (existsSync(qaBudget)) parts.push("-e", shellEscape(qaBudget));
      }
    }`;

const HEADER_BLOCK = `    if (loadout.agentDir) {
      const header = join(loadout.agentDir, "extensions", "custom-header.ts");
      if (existsSync(header)) parts.push("-e", shellEscape(header));
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
 * Drop `--no-lens-context` from a launcher that already has the scout branch.
 * That flag is registered by pi-lens, and scout starts with `--no-extensions`
 * and without pi-lens, so Pi exits with "Unknown option" before the child runs.
 * pi-lens is already left off the scout tool diet, so the flag does nothing.
 * @param {string} source
 */
export function stripScoutLensFlag(source) {
  if (!source.includes('parts.push("--no-lens-context")')) {
    return { status: "already-applied", source };
  }
  if (!source.includes(LENS_FLAG_LINE) || source.split(LENS_FLAG_LINE).length !== 2) {
    return { status: "skipped", reason: "lens flag not in the expected shape", source };
  }
  return { status: "applied", source: source.replace(LENS_FLAG_LINE, "") };
}

/**
 * Scout children skip pi-lens and load the tool-round cap.
 * QA children load the same kind of cap. No-op when the sandbox loop is absent
 * or both branches are already there. A launcher that already has the scout
 * branch gains the QA branch. A launcher that still passes `--no-lens-context`
 * loses that flag.
 * @param {string} source
 */
export function ensureScoutChildLaunch(source) {
  const stripped = stripScoutLensFlag(source);
  if (stripped.status === "skipped") return stripped;
  source = stripped.source;
  const hasScout = source.includes('loadout.agent === "scout"') && source.includes("scout-budget.ts");
  const hasQa = source.includes("qa-budget.ts");
  if (hasScout && hasQa) {
    return stripped.status === "applied"
      ? { status: "applied", source }
      : { status: "already-applied", source };
  }
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

/**
 * Every sandboxed child loads the Ultimate Pi header. Tool allowlists stay
 * as they are; this file registers no tools.
 * @param {string} source
 */
export function ensureChildHeader(source) {
  if (source.includes('extensions", "custom-header.ts"')) {
    return { status: "already-applied", source };
  }
  if (!source.includes(QA_BLOCK)) {
    return { status: "skipped", reason: "qa branch not in the expected shape", source };
  }
  if (source.split(QA_BLOCK).length !== 2) {
    return { status: "skipped", reason: "qa branch is not unique", source };
  }
  return { status: "applied", source: source.replace(QA_BLOCK, `${QA_BLOCK}\n${HEADER_BLOCK}`) };
}

const STDOUT_AND_STDERR_REDIRECT =
  "`${child} >> ${shellEscape(logPath)} 2>&1; echo '__SUBAGENT_DONE_'$?'__'`";
const STDERR_ONLY_REDIRECT =
  "`${child} 2>> ${shellEscape(logPath)}; echo '__SUBAGENT_DONE_'$?'__'`";

/**
 * Keep the child's screen on the tmux pane. A launcher that still sends
 * stdout and stderr to the log is switched to stderr only. No redirect, or
 * an existing stderr-only redirect, is left alone.
 * @param {string} source
 */
export function ensureStderrOnlyChildLog(source) {
  if (source.includes(STDERR_ONLY_REDIRECT)) {
    return { status: "already-applied", source };
  }
  if (!source.includes(STDOUT_AND_STDERR_REDIRECT)) {
    return { status: "already-applied", source };
  }
  if (source.split(STDOUT_AND_STDERR_REDIRECT).length !== 2) {
    return { status: "skipped", reason: "child log redirect is not unique", source };
  }
  return { status: "applied", source: source.replace(STDOUT_AND_STDERR_REDIRECT, STDERR_ONLY_REDIRECT) };
}

const SHUTDOWN_SCOPE_IMPORT = `import { partitionByParentSession } from "./shutdown-scope.ts";`;
const VIEWER_IMPORT = `import {
  renderAgentDocument,
  startViewer,
  type ViewerAgent,
  type ViewerHandle,
} from "./viewer.ts";`;

/**
 * A launcher that calls startViewer must import it. The published package
 * never calls it, and a file that already imports ./viewer.ts is left alone.
 * @param {string} source
 */
export function ensureViewerImport(source) {
  if (source.includes('from "./viewer.ts"')) {
    return { status: "already-applied", source };
  }
  if (!source.includes("startViewer(")) {
    return { status: "already-applied", source };
  }
  if (!source.includes(SHUTDOWN_SCOPE_IMPORT) || source.split(SHUTDOWN_SCOPE_IMPORT).length !== 2) {
    return { status: "skipped", reason: "shutdown-scope import not found", source };
  }
  return {
    status: "applied",
    source: source.replace(SHUTDOWN_SCOPE_IMPORT, `${SHUTDOWN_SCOPE_IMPORT}\n${VIEWER_IMPORT}`),
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
  for (const ensure of [
    ensureScoutChildLaunch,
    ensureSeparateThinkingFlag,
    ensureScoutToolDiet,
    ensureChildHeader,
    ensureStderrOnlyChildLog,
    ensureViewerImport,
  ]) {
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
