import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const EMIT_FROM = "async emit(event){let ctx=this.createContext(),result;";
const EMIT_TO = "async emit(event){if(this.staleMessage)return;let ctx=this.createContext(),result;";
const DISPATCH_FROM = "async _dispatchTurnEndBoundary(message,toolResults){";
const DISPATCH_GUARD = "if(this._extensionRunner.staleMessage)return!1;";

/**
 * Pi 1.0 still delivers extension events, and logs a turn_end boundary error,
 * after the session context has been replaced. Skip both once the runner is stale.
 */
export function patchStaleBoundarySource(source) {
  let next = source;
  if (next.includes(EMIT_FROM)) next = next.replaceAll(EMIT_FROM, EMIT_TO);
  const guarded = `${DISPATCH_FROM}${DISPATCH_GUARD}`;
  if (next.includes(DISPATCH_FROM) && !next.includes(guarded)) {
    next = next.replaceAll(DISPATCH_FROM, guarded);
  }
  return { source: next, changed: next !== source };
}

function piPackageRoots(agentDir) {
  const roots = [];
  if (agentDir) roots.push(path.join(agentDir, "npm/node_modules/@earendil-works/pi-coding-agent"));
  try {
    const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    if (globalRoot) roots.push(path.join(globalRoot, "@earendil-works/pi-coding-agent"));
  } catch {
    // pi may be installed outside npm's global root
  }
  return roots;
}

async function walkJs(dir, found) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkJs(full, found);
    else if (entry.isFile() && entry.name.endsWith(".js")) found.push(full);
  }
}

/** Patch installed Pi bundles that still emit on a replaced session. */
export async function applyStaleBoundaryPatch(agentDir) {
  const results = [];
  for (const root of piPackageRoots(agentDir)) {
    const files = [];
    await walkJs(root, files);
    let changed = 0;
    let seen = 0;
    for (const file of files) {
      let source;
      try {
        source = await fs.readFile(file, "utf8");
      } catch {
        continue;
      }
      if (!source.includes(EMIT_FROM) && !source.includes(DISPATCH_FROM) && !source.includes(EMIT_TO)) continue;
      seen += 1;
      const patched = patchStaleBoundarySource(source);
      if (!patched.changed) continue;
      await fs.writeFile(file, patched.source);
      changed += 1;
    }
    results.push({ root, changed, seen });
  }
  return results;
}
