import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspectDependencyPatch } from "../installer/dependency-patches.mjs";

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
