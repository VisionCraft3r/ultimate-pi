import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { writeFileAtomicSync } from "../lib/atomic-write.ts";

/** Packages Pi itself provides. An extension must peer them at "*", not depend on a private copy. */
export const HOST_PROVIDED_EXTENSION_PACKAGES = Object.freeze([
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
  "@mariozechner/pi-agent-core",
  "@mariozechner/pi-ai",
  "@mariozechner/pi-coding-agent",
  "@mariozechner/pi-tui",
  "@sinclair/typebox",
  "typebox",
]);

const HOST = new Set(HOST_PROVIDED_EXTENSION_PACKAGES);

function readManifest(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function packageRoots(npmRoot) {
  const roots = [];
  let entries = [];
  try {
    entries = readdirSync(npmRoot, { withFileTypes: true });
  } catch {
    return roots;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === ".bin") continue;
    const dir = path.join(npmRoot, entry.name);
    if (entry.name.startsWith("@")) {
      let scoped = [];
      try {
        scoped = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const child of scoped) {
        if (child.isDirectory()) roots.push(path.join(dir, child.name));
      }
      continue;
    }
    roots.push(dir);
  }
  return roots;
}

function nestedCopy(packageRoot, name) {
  return path.join(packageRoot, "node_modules", ...name.split("/"));
}

/**
 * Move host-provided names out of an extension's dependencies into peerDependencies "*".
 * Deletes that extension's nested copy of each moved package.
 * Packages without a `pi` field, and Pi's own packages, are left alone.
 */
export function rewriteHostPeerDeps(agentDir) {
  const npmRoot = path.join(agentDir, "npm", "node_modules");
  const rewritten = [];
  const removed = [];
  if (!existsSync(npmRoot)) return { rewritten, removed };

  for (const root of packageRoots(npmRoot)) {
    const manifestPath = path.join(root, "package.json");
    const manifest = readManifest(manifestPath);
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) continue;
    if (!manifest.pi || typeof manifest.pi !== "object" || Array.isArray(manifest.pi)) continue;
    if (typeof manifest.name === "string" && HOST.has(manifest.name)) continue;
    const dependencies = manifest.dependencies;
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) continue;

    const hostNames = Object.keys(dependencies).filter((name) => HOST.has(name)).sort();
    if (hostNames.length === 0) continue;

    const peers = manifest.peerDependencies && typeof manifest.peerDependencies === "object" && !Array.isArray(manifest.peerDependencies)
      ? { ...manifest.peerDependencies }
      : {};
    for (const name of hostNames) {
      peers[name] = "*";
      delete dependencies[name];
    }
    manifest.peerDependencies = peers;
    if (Object.keys(dependencies).length === 0) delete manifest.dependencies;
    else manifest.dependencies = dependencies;
    writeFileAtomicSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    rewritten.push(manifest.name ?? path.basename(root));

    for (const name of hostNames) {
      const copy = nestedCopy(root, name);
      if (!existsSync(copy)) continue;
      rmSync(copy, { recursive: true, force: true });
      removed.push(path.relative(agentDir, copy));
      const scopeDir = path.dirname(copy);
      if (path.basename(path.dirname(scopeDir)) === "node_modules" && path.basename(scopeDir).startsWith("@")) {
        try {
          if (readdirSync(scopeDir).length === 0) rmSync(scopeDir, { recursive: true, force: true });
        } catch {
          // the scope directory is already gone
        }
      }
    }
  }

  return { rewritten, removed };
}
