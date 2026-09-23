import fs from "node:fs/promises";
import path from "node:path";
import {
  AGENT_NAMES,
  AGENTS_MD_BEGIN,
  AGENTS_MD_END,
  MANAGED_AGENT_MARKER,
} from "./schema.mjs";

const AGENTS_MD_FILE = "AGENTS.md";

function malformedMarkersError(hasBegin, hasEnd, endBeforeBegin) {
  const begin = hasBegin ? "begin present" : "begin missing";
  const end = hasEnd ? "end present" : "end missing";
  const order = endBeforeBegin ? "; end appears before begin" : "";
  return new Error(
    `malformed ultimate-pi markers in ${AGENTS_MD_FILE}: ${begin}, ${end}${order}; refusing to delete user content`,
  );
}

/**
 * Remove the managed `<!-- ultimate-pi:begin -->` … `<!-- ultimate-pi:end -->`
 * block from `<agentDir>/AGENTS.md`, leaving user text outside the markers.
 * Absent markers (or a missing file) are a no-op. One-sided or mis-ordered
 * markers throw without writing. `options.dryRun` skips backup and write.
 * Non-dry-run removal requires `backupSession.backupIfExists` (awaited) and
 * throws before write if it is missing.
 */
export async function removeManagedAgentsBlock(agentDir, backupSession, options = {}) {
  const file = path.join(agentDir, AGENTS_MD_FILE);
  let text;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { removed: false };
    throw err;
  }

  const start = text.indexOf(AGENTS_MD_BEGIN);
  const end = text.indexOf(AGENTS_MD_END);
  const hasBegin = start >= 0;
  const hasEnd = end >= 0;

  if (!hasBegin && !hasEnd) {
    return { removed: false };
  }
  if (!hasBegin || !hasEnd || end < start) {
    throw malformedMarkersError(hasBegin, hasEnd, hasBegin && hasEnd && end < start);
  }

  const next = text.slice(0, start) + text.slice(end + AGENTS_MD_END.length);

  if (options.dryRun) {
    return { removed: true, dryRun: true };
  }

  if (typeof backupSession?.backupIfExists !== "function") {
    throw new Error(
      `backupSession.backupIfExists is required before removing the managed ${AGENTS_MD_FILE} block`,
    );
  }
  await backupSession.backupIfExists(AGENTS_MD_FILE);
  await fs.writeFile(file, next, "utf8");
  return { removed: true };
}

function profileRelPaths() {
  const paths = [];
  for (const name of AGENT_NAMES) {
    paths.push(path.join("agents", `${name}.md`));
    paths.push(path.join("agents", `${name}.ultimate-pi.md`));
  }
  return paths;
}

async function readUtf8IfExists(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return undefined;
    throw err;
  }
}

/**
 * Delete managed agent profiles under `<agentDir>/agents/` for the five
 * `AGENT_NAMES` only (`<name>.md` and `<name>.ultimate-pi.md` sidecars).
 * Files without the exact `MANAGED_AGENT_MARKER` are left untouched.
 * Non-dry-run unlinks require `backupSession.backupIfExists` (awaited per
 * file before unlink) and throw before any unlink if it is missing.
 * `options.dryRun` returns planned relative paths with no writes.
 */
export async function removeManagedAgentProfiles(agentDir, backupSession, options = {}) {
  const planned = [];
  for (const relPath of profileRelPaths()) {
    const text = await readUtf8IfExists(path.join(agentDir, relPath));
    if (text !== undefined && text.includes(MANAGED_AGENT_MARKER)) {
      planned.push(relPath);
    }
  }

  if (options.dryRun) {
    return { removed: planned, dryRun: true };
  }
  if (planned.length === 0) {
    return { removed: planned };
  }

  if (typeof backupSession?.backupIfExists !== "function") {
    throw new Error(
      "backupSession.backupIfExists is required before removing managed agent profiles",
    );
  }
  for (const relPath of planned) {
    await backupSession.backupIfExists(relPath);
    await fs.unlink(path.join(agentDir, relPath));
  }
  return { removed: planned };
}
