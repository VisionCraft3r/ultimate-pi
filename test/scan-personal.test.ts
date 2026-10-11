import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { DENY_TERMS } from "../scripts/scan-personal.mjs";

const scanner = fileURLToPath(new URL("../scripts/scan-personal.mjs", import.meta.url));
const gitleaksToml = fileURLToPath(new URL("../.gitleaks.toml", import.meta.url));

async function inRepository(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "upi-personal-scan-"));
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: dir });
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function track(dir: string, text: string) {
  await writeFile(join(dir, "fixture.txt"), text);
  execFileSync("git", ["add", "fixture.txt"], { cwd: dir });
}

function scan(dir: string) {
  const result = spawnSync(process.execPath, [scanner], { cwd: dir, encoding: "utf8" });
  assert.equal(result.error, undefined);
  return { status: result.status, output: result.stdout + result.stderr };
}

test(".gitleaks.toml denylist alternation matches DENY_TERMS exactly", async () => {
  const toml = await readFile(gitleaksToml, "utf8");
  const match = toml.match(/regex = '''.*?\(\?:([^)]+)\)\\b/);
  assert.ok(match, "expected a (?:term|term|...) alternation group in the gitleaks regex");
  const terms = match![1].split("|");
  assert.deepEqual(terms.sort(), [...DENY_TERMS].sort());
});

test("a tracked file containing a denylisted term fails the scan", () => inRepository(async (dir) => {
  await track(dir, "see GodsEye for details");
  const result = scan(dir);
  assert.equal(result.status, 1);
  assert.match(result.output, /denylisted term "godseye"/i);
}));

test("word-boundary matching avoids false positives like 'cursor provider'", () => inRepository(async (dir) => {
  await track(dir, "set the cursor provider to anthropic");
  const result = scan(dir);
  assert.equal(result.status, 0);
}));
