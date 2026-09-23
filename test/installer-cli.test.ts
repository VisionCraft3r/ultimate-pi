import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { parseArgs } from "../bin/ultimate-pi.mjs";

const BIN = resolve(fileURLToPath(new URL("../bin/ultimate-pi.mjs", import.meta.url)));

function spawnCli(args, extraEnv = {}) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, ...extraEnv };
  for (const key of Object.keys(env)) {
    if (key.startsWith("PI_SUBAGENT_")) delete env[key];
  }
  delete env["PI_CODING_AGENT_DIR"];
  delete env["PI_OFFLINE"];
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8",
    env,
    cwd: resolve(fileURLToPath(new URL("..", import.meta.url))),
  });
}

test("npm-style symlink invokes the CLI rather than silently exiting", () => {
  const dir = mkdtempSync(join(tmpdir(), "ultimate-pi-cli-"));
  try {
    const link = join(dir, "ultimate-pi");
    symlinkSync(BIN, link);
    const result = spawnSync(process.execPath, [link, "--help"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:\s+ultimate-pi/);
    assert.match(result.stdout, /--agent-dir/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("install --yes aborts with pi login guidance before writing settings", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "ultimate-pi-cli-yes-"));
  try {
    const result = spawnCli(["install", "--yes", "--offline", "--agent-dir", agentDir]);
    const text = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 1, text);
    assert.match(text, /pi login/);
    assert.match(text, /anthropic/);
    assert.match(text, /then re-run install/);
    assert.match(text, /No settings or packages were applied/);
    assert.equal(existsSync(join(agentDir, "settings.json")), false);
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("parseArgs accepts uninstall --full and --purge without inventing a new command", () => {
  const full = parseArgs(["uninstall", "--full", "--offline"]);
  assert.equal(full.command, "uninstall");
  assert.equal(full.full, true);
  assert.equal(full.purge, true);
  assert.equal(full.offline, true);

  const purge = parseArgs(["uninstall", "--purge"]);
  assert.equal(purge.full, true);
  assert.equal(purge.purge, true);

  const def = parseArgs(["uninstall"]);
  assert.equal(def.full, false);
  assert.equal(def.purge, false);
});
