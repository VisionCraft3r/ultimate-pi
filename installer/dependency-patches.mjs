import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PATCH_DIR = fileURLToPath(new URL("../patches/", import.meta.url));

/** Exact published preimages: never patch a different upstream build. */
export const DEPENDENCY_PATCHES = Object.freeze([
  {
    name: "@schultzp2020/pi-cursor",
    version: "0.5.2",
    root: "npm/node_modules/@schultzp2020/pi-cursor",
    target: "dist/proxy/main.js",
    patch: "pi-cursor-idle-0.5.2.patch",
    before: "fac8964e80770c7003d1c8719c08fd834a723eb3fc4ccb1442d5ef3a57429bed",
    after: "4d05e91ce9b1de36c1289a70a40db91407bf284d93c6c9a2ae9501166dec3b24",
  },
  {
    name: "@schultzp2020/pi-cursor",
    version: "0.5.2",
    root: "npm/node_modules/@schultzp2020/pi-cursor",
    target: "dist/index.js",
    patch: "pi-cursor-stale-ctx-0.5.2.patch",
    before: "ac2b0544559910f836e627a8c292ea303492b7100174bf0ca3b30a7cab1fa900",
    after: "180c81c74411948dfed5b41ad441416cdd172f69fbae58576bc7b3638204664d",
  },
  {
    name: "pi-graft",
    version: "0.1.2",
    root: "npm/node_modules/pi-graft",
    target: "extensions/graft.ts",
    patch: "pi-graft-async-0.1.2.patch",
    before: "663479e235ac247211f64e5d6015995d8cff04e33726fc639eaa0b1edfe5e6bb",
    after: "11502aa5ae65d8b0a8a852c5903fe02982e812e3f1b64d3d1eb4bf458f1ec78e",
    supersededBy: "0e80c4207393e90cd862514cc6e4ef3c5b0cf925a770f89cc2b32c7b277503a4",
  },
  {
    name: "pi-graft",
    version: "0.1.2",
    root: "npm/node_modules/pi-graft",
    target: "extensions/graft.ts",
    patch: "pi-graft-subagent-task.patch",
    before: "11502aa5ae65d8b0a8a852c5903fe02982e812e3f1b64d3d1eb4bf458f1ec78e",
    after: "0e80c4207393e90cd862514cc6e4ef3c5b0cf925a770f89cc2b32c7b277503a4",
    supersededBy: "0f9002d52221f57fbbcd0bf6d1f5e123f94532eed49a9e051efd0bc55cd91f51",
  },
  {
    name: "pi-graft",
    version: "0.1.2",
    root: "npm/node_modules/pi-graft",
    target: "extensions/graft.ts",
    patch: "pi-graft-stale-ctx-0.1.2.patch",
    before: "0e80c4207393e90cd862514cc6e4ef3c5b0cf925a770f89cc2b32c7b277503a4",
    after: "0f9002d52221f57fbbcd0bf6d1f5e123f94532eed49a9e051efd0bc55cd91f51",
    supersededBy: "db3eef0b520bebaf0afe9457e7013c431676793ea00cf20fdeb5aaf9965e4d1d",
  },
  {
    name: "pi-graft",
    version: "0.1.2",
    root: "npm/node_modules/pi-graft",
    target: "extensions/graft.ts",
    patch: "pi-graft-workspace-stats-0.1.2.patch",
    before: "0f9002d52221f57fbbcd0bf6d1f5e123f94532eed49a9e051efd0bc55cd91f51",
    after: "db3eef0b520bebaf0afe9457e7013c431676793ea00cf20fdeb5aaf9965e4d1d",
    supersededBy: "e3f2684791d8d44fc909d84a887f58996001307be71bb3fdb10fbead5dfc6bdb",
  },
  {
    name: "pi-graft",
    version: "0.1.2",
    root: "npm/node_modules/pi-graft",
    target: "extensions/graft.ts",
    patch: "pi-graft-settled-stale-0.1.2.patch",
    before: "db3eef0b520bebaf0afe9457e7013c431676793ea00cf20fdeb5aaf9965e4d1d",
    after: "e3f2684791d8d44fc909d84a887f58996001307be71bb3fdb10fbead5dfc6bdb",
  },
  {
    name: "observational-memory",
    version: "0.1.0",
    root: "git/github.com/amosblomqvist/pi-observational-memory",
    target: "src/hooks/observer-trigger.ts",
    patch: "pi-observational-memory-observer-stale.patch",
    before: "0bfe292de9bfd3e95a48e7499f98401d69a07b4e4f77602f9cc27945fbd87db9",
    after: "f45758d173508b0384447d790531d401e29374e78b5472287f081eb67a24f8c0",
  },
  {
    name: "observational-memory",
    version: "0.1.0",
    root: "git/github.com/amosblomqvist/pi-observational-memory",
    target: "src/hooks/consolidator-trigger.ts",
    patch: "pi-observational-memory-consolidator-stale.patch",
    before: "4594cd243c4a5aff2e11e057dd4b0431fd76fc1e6506c0695e57a7bc1229e121",
    after: "766634f8364569369ef7d78012363a7aa84ac679620b8f6db9436f6dee7dd061",
  },
  {
    name: "observational-memory",
    version: "0.1.0",
    root: "git/github.com/amosblomqvist/pi-observational-memory",
    target: "src/hooks/compaction-trigger.ts",
    patch: "pi-observational-memory-compaction-stale.patch",
    before: "6d3e7abc671d8ed6d0c3706d3d74f0277e541038e35d03fadc11b2210edcf2d0",
    after: "cb757631b32a76f4a49fe6c11d2bde41bcd6d3bd172a7857bdc5c7ca0d1f2bc7",
  },
  {
    name: "pi-interactive-subagents",
    version: "3.7.2",
    root: "git/github.com/amosblomqvist/pi-interactive-subagents",
    target: "pi-extension/subagents/activity.ts",
    patch: "pi-interactive-subagents-activity.patch",
    before: "2f8ef422f668e7e8fddfe084f37ebe6ee44865ce32c2a981a765bb6c213b2c61",
    after: "e37f908e912ade6eebfc4048e7bc71898597f89f630da9f5c2fca1dd1db45324",
  },
  {
    name: "pi-interactive-subagents",
    version: "3.7.2",
    root: "git/github.com/amosblomqvist/pi-interactive-subagents",
    target: "pi-extension/subagents/index.ts",
    patch: "pi-interactive-subagents-stale-ctx.patch",
    before: "0a438726c0a9e5bd02d0b87141b41238aae7c39ac2faa4f4a96eb0f5e1ecb1a4",
    after: "96dfdb1d722fcb6a478ccf919aae698b5f6f2fe6b770145aeca6acb21f711136",
  },
]);

/** True when this setup is installing the package the patch targets. */
export function dependencyPatchApplies(descriptor, specs) {
  const list = Array.isArray(specs) ? specs.map((spec) => String(spec)) : [];
  if (descriptor.name === "pi-interactive-subagents") {
    return list.some((spec) => spec.includes("pi-interactive-subagents"));
  }
  if (descriptor.name === "@schultzp2020/pi-cursor") {
    return list.some((spec) => spec.includes("pi-cursor"));
  }
  if (descriptor.name === "pi-graft") {
    return list.some((spec) => spec.includes("pi-graft"));
  }
  if (descriptor.name === "observational-memory") {
    return list.some((spec) => spec.includes("pi-observational-memory"));
  }
  return false;
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Inspect only; never mutate an installation whose version or bytes differ. */
export async function inspectDependencyPatch(agentDir, descriptor) {
  const allowed = await fs.realpath(agentDir);
  const packageRoot = path.resolve(allowed, descriptor.root);
  if (!inside(allowed, packageRoot)) return { status: "skipped", reason: "package outside agent directory" };

  let actualRoot;
  let target;
  let manifest;
  let bytes;
  try {
    actualRoot = await fs.realpath(packageRoot);
    target = await fs.realpath(path.join(actualRoot, descriptor.target));
    if (!inside(allowed, actualRoot) || !inside(actualRoot, target)) {
      return { status: "skipped", reason: "dependency path escapes agent directory" };
    }
    manifest = JSON.parse(await fs.readFile(path.join(actualRoot, "package.json"), "utf8"));
    bytes = await fs.readFile(target);
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "skipped", reason: "dependency not installed" };
    throw error;
  }

  if (manifest.name !== descriptor.name || manifest.version !== descriptor.version) {
    return { status: "skipped", reason: `expected ${descriptor.name}@${descriptor.version}; found ${manifest.name ?? "unknown"}@${manifest.version ?? "unknown"}` };
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 === descriptor.after || sha256 === descriptor.supersededBy) return { status: "already-applied", target, sha256 };
  if (sha256 === descriptor.before) return { status: "ready", target, sha256 };
  return { status: "skipped", reason: `target checksum mismatch for ${descriptor.name}@${descriptor.version}` };
}

/** Apply only to the exact pinned preimage; make a timestamped backup first. */
export async function applyDependencyPatch(agentDir, descriptor, backupSession, options = {}) {
  const inspected = await inspectDependencyPatch(agentDir, descriptor);
  if (inspected.status !== "ready") return inspected;
  if (options.dryRun) return { ...inspected, status: "would-apply" };
  if (typeof backupSession?.backupIfExists !== "function" || !backupSession.dir) {
    throw new Error(`backup session required before patching ${descriptor.name}`);
  }
  if (path.basename(descriptor.patch) !== descriptor.patch) {
    throw new Error(`invalid patch filename for ${descriptor.name}`);
  }
  const relativeTarget = path.join(descriptor.root, descriptor.target);
  const patchFile = path.join(PATCH_DIR, descriptor.patch);
  // Root is derived from the pinned descriptor; resolve symlinks again before writing.
  const actualRoot = await fs.realpath(path.join(agentDir, descriptor.root));
  if (!inside(await fs.realpath(agentDir), actualRoot)) {
    throw new Error(`dependency path escaped agent directory: ${descriptor.name}`);
  }
  await execFileAsync("git", ["apply", "--check", patchFile], { cwd: actualRoot });
  await backupSession.backupIfExists(relativeTarget);
  await execFileAsync("git", ["apply", patchFile], { cwd: actualRoot });
  const after = await inspectDependencyPatch(agentDir, descriptor);
  if (after.status !== "already-applied") {
    await fs.copyFile(path.join(backupSession.dir, relativeTarget), inspected.target);
    throw new Error(`patched checksum mismatch for ${descriptor.name}; restored backup`);
  }
  return { status: "applied", target: inspected.target, sha256: after.sha256 };
}
