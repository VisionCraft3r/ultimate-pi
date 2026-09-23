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
    name: "pi-interactive-subagents",
    version: "3.7.2",
    root: "git/github.com/amosblomqvist/pi-interactive-subagents",
    target: "pi-extension/subagents/activity.ts",
    patch: "pi-interactive-subagents-activity.patch",
    before: "2f8ef422f668e7e8fddfe084f37ebe6ee44865ce32c2a981a765bb6c213b2c61",
    after: "e37f908e912ade6eebfc4048e7bc71898597f89f630da9f5c2fca1dd1db45324",
  },
]);

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
  if (sha256 === descriptor.after) return { status: "already-applied", target, sha256 };
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
