#!/usr/bin/env node
/**
 * End-to-end non-interactive install smoke test against a temp agent dir.
 * Uses dummy answers + --offline and an isolated temp agent dir.
 * Exit 0 = passed. Exit 1 = failed.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "bin", "ultimate-pi.mjs");
const ANSWERS = join(ROOT, "test", "fixtures", "answers.json");

function run(args, { allowNonZero = false } = {}) {
  const env = { ...process.env };
  delete env.PI_CODING_AGENT_DIR;
  delete env.PI_OFFLINE;
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (!allowNonZero && result.status !== 0) {
    const err = new Error(`command exited ${result.status}`);
    err.result = result;
    throw err;
  }
  return result;
}

function ok(label) {
  console.log(`✔ ${label}`);
}

function fail(label, detail) {
  console.log(`✖ ${label}`);
  if (detail) console.error(detail);
}

let agentDir;
let failed = false;

try {
  agentDir = mkdtempSync(join(tmpdir(), "ultimate-pi-smoke-"));

  const install = run([
    CLI,
    "install",
    "--agent-dir",
    agentDir,
    "--answers",
    ANSWERS,
    "--yes",
    "--offline",
  ]);
  if (/✖/.test(install.stdout + install.stderr)) throw new Error("install reported a failed check");
  const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
  for (const spec of ["npm:pi-lens", "npm:pi-graft"]) {
    if (!settings.packages.includes(spec)) throw new Error(`missing required package ${spec}`);
  }
  for (const name of ["scout", "worker", "planner", "researcher", "qa_tester"]) {
    if (!existsSync(join(agentDir, "agents", `${name}.md`))) throw new Error(`missing ${name} agent profile`);
  }
  ok("install --offline --yes --answers (exit 0; required tools and profiles present)");

  const doctor = run([CLI, "doctor", "--agent-dir", agentDir, "--offline"]);
  if (/✖/.test(doctor.stdout + doctor.stderr)) throw new Error("doctor reported a failed check");
  ok("doctor --offline (exit 0; no failed checks)");
} catch (err) {
  failed = true;
  fail(err.message, err.result ? err.result.stderr || err.result.stdout : err.stack);
} finally {
  if (agentDir) {
    try {
      rmSync(agentDir, { recursive: true, force: true });
      ok(`cleaned up ${agentDir}`);
    } catch (err) {
      fail(`cleanup ${agentDir}`, err.message);
      failed = true;
    }
  }
}

if (failed) {
  console.log("✖ smoke-install failed");
  process.exitCode = 1;
} else {
  console.log("✔ smoke-install passed");
  process.exitCode = 0;
}
