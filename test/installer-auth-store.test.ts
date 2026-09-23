import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mergeCredentials, readAuth } from "../installer/auth-store.mjs";

async function makeTempDir() {
  return mkdtemp(path.join(tmpdir(), "ultimate-pi-auth-test-"));
}

test("mergeCredentials writes api_key entries and leaves oauth providers alone", async () => {
  const dir = await makeTempDir();
  try {
    const providers = [
      { id: "openrouter", authMethod: "api-key", credential: "test-key-not-real" },
      { id: "anthropic", authMethod: "oauth" },
    ];
    const result = await mergeCredentials(dir, providers);
    assert.deepEqual(result.openrouter, { type: "api_key", key: "test-key-not-real" });
    assert.equal(result.anthropic, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mergeCredentials backs up an existing auth.json before overwriting", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(path.join(dir, "auth.json"), JSON.stringify({ anthropic: { type: "oauth" } }));
    await mergeCredentials(dir, [{ id: "openrouter", authMethod: "api-key", credential: "test-key-not-real" }]);
    const backup = JSON.parse(await readFile(path.join(dir, "auth.json.bak"), "utf8"));
    assert.deepEqual(backup, { anthropic: { type: "oauth" } });
    const next = await readAuth(dir);
    assert.equal(next.anthropic.type, "oauth");
    assert.equal(next.openrouter.key, "test-key-not-real");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mergeCredentials chmods auth.json to 600", async () => {
  const dir = await makeTempDir();
  try {
    await mergeCredentials(dir, [{ id: "deepseek", authMethod: "api-key", credential: "test-key-not-real" }]);
    const info = await stat(path.join(dir, "auth.json"));
    assert.equal(info.mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readAuth returns {} for a missing file", async () => {
  const dir = await makeTempDir();
  try {
    const auth = await readAuth(dir);
    assert.deepEqual(auth, {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
