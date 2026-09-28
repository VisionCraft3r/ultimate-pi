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

const TYPE_NEEDLE = "const CONTEXT_PACKAGES: { segments: string[]; tools: readonly string[] }[] = [";
const TYPE_REPLACEMENT =
  "const CONTEXT_PACKAGES: { segments: string[]; tools: readonly string[]; whenTools?: readonly string[] }[] = [";

const CLOSE_NEEDLE = `    tools: ["plannotator_submit_plan", "plannotator_mark_done"],
  },
];`;

const ENTRY = `
  {
    segments: ["npm", "node_modules", "@lucascardozo", "pi-edit-guard"],
    tools: [],
    whenTools: ["edit", "write"],
  },`;

const LOOP_NEEDLE = `    if (entries.length === 0) continue;
    paths.push(...entries);`;

const LOOP_REPLACEMENT = `    if (entries.length === 0) continue;
    if (pkg.whenTools && !pkg.whenTools.some((tool) => grantedTools.has(tool))) continue;
    paths.push(...entries);`;

/**
 * Reattach pi-edit-guard on children that already have edit or write.
 * No-op when the local CONTEXT_PACKAGES launcher is absent or already gated.
 * @param {string} source
 */
export function ensureEditGuardChildGate(source) {
  if (!source.includes("const CONTEXT_PACKAGES")) {
    return { status: "skipped", reason: "CONTEXT_PACKAGES absent", source };
  }
  if (source.includes('"pi-edit-guard"')) {
    return { status: "already-applied", source };
  }
  if (!source.includes(TYPE_NEEDLE) || !source.includes(CLOSE_NEEDLE) || !source.includes(LOOP_NEEDLE)) {
    return { status: "skipped", reason: "launcher shape differs from the local context-package hook", source };
  }
  const next = source
    .replace(TYPE_NEEDLE, TYPE_REPLACEMENT)
    .replace(CLOSE_NEEDLE, `    tools: ["plannotator_submit_plan", "plannotator_mark_done"],
  },${ENTRY}
];`)
    .replace(LOOP_NEEDLE, LOOP_REPLACEMENT);
  return { status: "applied", source: next };
}

/** Apply the gate to the installed subagent launcher. Missing launcher is a skip. */
export async function applyEditGuardChildGate(agentDir) {
  if (!agentDir) return { status: "skipped", reason: "no agent directory" };
  const target = path.join(agentDir, LAUNCHER);
  let source;
  try {
    source = await fs.readFile(target, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "skipped", reason: "subagent launcher not installed" };
    throw error;
  }
  const result = ensureEditGuardChildGate(source);
  if (result.status === "applied") await fs.writeFile(target, result.source);
  return { status: result.status, reason: result.reason, target };
}
