import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEPENDENCY_PATCHES, inspectDependencyPatch } from "../installer/dependency-patches.mjs";

const BEFORE = "fixture-before\n";
const AFTER = "fixture-after\n";
const OTHER = "fixture-other\n";

function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

const DESCRIPTOR = {
  name: "fixture-dep",
  version: "1.0.0",
  root: "pkg/fixture-dep",
  target: "src/target.js",
  patch: "fixture.patch",
  before: sha256(BEFORE),
  after: sha256(AFTER),
};

async function makeAgentDir() {
  return mkdtemp(path.join(tmpdir(), "ultimate-pi-dep-patches-"));
}

async function writeFixture(agentDir: string, { version = DESCRIPTOR.version, body = BEFORE } = {}) {
  const packageRoot = path.join(agentDir, DESCRIPTOR.root);
  await mkdir(path.join(packageRoot, path.dirname(DESCRIPTOR.target)), { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify({ name: DESCRIPTOR.name, version })}\n`,
  );
  await writeFile(path.join(packageRoot, DESCRIPTOR.target), body);
}

test("pi-graft async patch is pinned to the published 0.1.2 preimage", () => {
  const graft = DEPENDENCY_PATCHES.find((entry) => entry.patch === "pi-graft-async-0.1.2.patch");
  const follow = DEPENDENCY_PATCHES.find((entry) => entry.patch === "pi-graft-subagent-task.patch");
  const stale = DEPENDENCY_PATCHES.find((entry) => entry.patch === "pi-graft-stale-ctx-0.1.2.patch");
  assert.ok(graft);
  assert.ok(follow);
  assert.ok(stale);
  assert.equal(graft.version, "0.1.2");
  assert.equal(graft.target, "extensions/graft.ts");
  assert.equal(graft.before, "663479e235ac247211f64e5d6015995d8cff04e33726fc639eaa0b1edfe5e6bb");
  assert.equal(graft.after, "11502aa5ae65d8b0a8a852c5903fe02982e812e3f1b64d3d1eb4bf458f1ec78e");
  assert.equal(follow.before, graft.after);
  assert.equal(follow.after, "0e80c4207393e90cd862514cc6e4ef3c5b0cf925a770f89cc2b32c7b277503a4");
  assert.equal(graft.supersededBy, follow.after);
  assert.equal(stale.before, follow.after);
  assert.equal(stale.after, "0f9002d52221f57fbbcd0bf6d1f5e123f94532eed49a9e051efd0bc55cd91f51");
  assert.equal(follow.supersededBy, stale.after);
  assert.ok(DEPENDENCY_PATCHES.indexOf(follow) > DEPENDENCY_PATCHES.indexOf(graft));
  assert.ok(DEPENDENCY_PATCHES.indexOf(stale) > DEPENDENCY_PATCHES.indexOf(follow));
  const cursor = DEPENDENCY_PATCHES.find((entry) => entry.patch === "pi-cursor-stale-ctx-0.5.2.patch");
  assert.ok(cursor);
  assert.equal(cursor.version, "0.5.2");
  assert.equal(cursor.target, "dist/index.js");
  assert.equal(cursor.before, "ac2b0544559910f836e627a8c292ea303492b7100174bf0ca3b30a7cab1fa900");
  assert.equal(cursor.after, "180c81c74411948dfed5b41ad441416cdd172f69fbae58576bc7b3638204664d");
  const subagents = DEPENDENCY_PATCHES.find((entry) => entry.patch === "pi-interactive-subagents-stale-ctx.patch");
  assert.ok(subagents);
  assert.equal(subagents.name, "pi-interactive-subagents");
  assert.equal(subagents.version, "3.7.2");
  assert.equal(subagents.target, "pi-extension/subagents/index.ts");
  assert.equal(subagents.before, "0a438726c0a9e5bd02d0b87141b41238aae7c39ac2faa4f4a96eb0f5e1ecb1a4");
  assert.equal(subagents.after, "96dfdb1d722fcb6a478ccf919aae698b5f6f2fe6b770145aeca6acb21f711136");
});

test("ready when target matches the before hash", async () => {
  const agentDir = await makeAgentDir();
  try {
    await writeFixture(agentDir, { body: BEFORE });
    const result = await inspectDependencyPatch(agentDir, DESCRIPTOR);
    assert.equal(result.status, "ready");
    assert.equal(result.sha256, DESCRIPTOR.before);
    assert.equal(result.target, await realpath(path.join(agentDir, DESCRIPTOR.root, DESCRIPTOR.target)));
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("a follow-up post-image counts as the earlier patch already applied", async () => {
  const agentDir = await makeAgentDir();
  try {
    await writeFixture(agentDir, { body: AFTER });
    const result = await inspectDependencyPatch(agentDir, {
      ...DESCRIPTOR,
      after: sha256("later-after\n"),
      supersededBy: sha256(AFTER),
    });
    assert.equal(result.status, "already-applied");
    assert.equal(result.sha256, sha256(AFTER));
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("already-applied when target matches the after hash", async () => {
  const agentDir = await makeAgentDir();
  try {
    await writeFixture(agentDir, { body: AFTER });
    const result = await inspectDependencyPatch(agentDir, DESCRIPTOR);
    assert.equal(result.status, "already-applied");
    assert.equal(result.sha256, DESCRIPTOR.after);
    assert.equal(result.target, await realpath(path.join(agentDir, DESCRIPTOR.root, DESCRIPTOR.target)));
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("skips on package version mismatch even when bytes match the before hash", async () => {
  const agentDir = await makeAgentDir();
  try {
    await writeFixture(agentDir, { version: "9.9.9", body: BEFORE });
    const result = await inspectDependencyPatch(agentDir, DESCRIPTOR);
    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "expected fixture-dep@1.0.0; found fixture-dep@9.9.9");
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("skips on target checksum mismatch", async () => {
  const agentDir = await makeAgentDir();
  try {
    await writeFixture(agentDir, { body: OTHER });
    const result = await inspectDependencyPatch(agentDir, DESCRIPTOR);
    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "target checksum mismatch for fixture-dep@1.0.0");
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("skips when a package-root symlink escapes agentDir", async () => {
  const parent = await makeAgentDir();
  const agentDir = path.join(parent, "agent");
  const outside = path.join(parent, "outside");
  try {
    await mkdir(agentDir);
    await mkdir(path.join(outside, path.dirname(DESCRIPTOR.target)), { recursive: true });
    await writeFile(
      path.join(outside, "package.json"),
      `${JSON.stringify({ name: DESCRIPTOR.name, version: DESCRIPTOR.version })}\n`,
    );
    await writeFile(path.join(outside, DESCRIPTOR.target), BEFORE);
    await mkdir(path.join(agentDir, path.dirname(DESCRIPTOR.root)), { recursive: true });
    await symlink(outside, path.join(agentDir, DESCRIPTOR.root));

    const result = await inspectDependencyPatch(agentDir, DESCRIPTOR);
    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "dependency path escapes agent directory");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
