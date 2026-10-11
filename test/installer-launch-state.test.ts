import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { recordSourceRoot } from "../installer/launch-state.mjs";

async function makeTempDir(prefix) {
  return mkdtemp(path.join(tmpdir(), prefix));
}

test("recordSourceRoot writes sourceRoot and keeps existing keys when repoRoot has .git", async () => {
  const agentDir = await makeTempDir("ultimate-pi-launch-agent-");
  const repoRoot = await makeTempDir("ultimate-pi-launch-repo-");
  try {
    await mkdir(path.join(repoRoot, ".git"), { recursive: true });
    const statePath = path.join(agentDir, "ultimate-pi-launch.json");
    await writeFile(statePath, JSON.stringify({ hash: "existing-hash", at: "2026-01-01T00:00:00.000Z" }));

    const wrote = await recordSourceRoot(agentDir, repoRoot);
    assert.equal(wrote, true);

    const state = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(state.sourceRoot, path.resolve(repoRoot));
    assert.equal(state.hash, "existing-hash");
    assert.equal(state.at, "2026-01-01T00:00:00.000Z");
  } finally {
    await rm(agentDir, { recursive: true, force: true });
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("recordSourceRoot creates the file when it is missing or unparsable", async () => {
  const agentDir = await makeTempDir("ultimate-pi-launch-agent-");
  const repoRoot = await makeTempDir("ultimate-pi-launch-repo-");
  try {
    await mkdir(path.join(repoRoot, ".git"), { recursive: true });
    const statePath = path.join(agentDir, "ultimate-pi-launch.json");
    await writeFile(statePath, "not json");

    const wrote = await recordSourceRoot(agentDir, repoRoot);
    assert.equal(wrote, true);
    const state = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(state.sourceRoot, path.resolve(repoRoot));
  } finally {
    await rm(agentDir, { recursive: true, force: true });
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("recordSourceRoot returns false and writes nothing without .git", async () => {
  const agentDir = await makeTempDir("ultimate-pi-launch-agent-");
  const repoRoot = await makeTempDir("ultimate-pi-launch-repo-");
  try {
    const statePath = path.join(agentDir, "ultimate-pi-launch.json");

    const wrote = await recordSourceRoot(agentDir, repoRoot);
    assert.equal(wrote, false);
    await assert.rejects(readFile(statePath, "utf8"));
  } finally {
    await rm(agentDir, { recursive: true, force: true });
    await rm(repoRoot, { recursive: true, force: true });
  }
});
