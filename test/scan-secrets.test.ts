import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { DEPENDENCY_PATCHES } from "../installer/dependency-patches.mjs";

const scanner = fileURLToPath(new URL("../scripts/scan-secrets.mjs", import.meta.url));
// Construct synthetic leak-shaped strings only at runtime, never as repo literals.
const unknownHex = "a1".repeat(32);
const tavilyKey = ["tv", "ly", "-", "synthetic_".repeat(4)].join("");

async function inRepository(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "upi-secret-scan-"));
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

function commit(dir: string) {
  execFileSync("git", ["-c", "user.name=Scanner Fixture", "-c", "user.email=scanner@example.invalid",
    "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "scanner fixture"], { cwd: dir });
}

test("scanner permits only the documented exact public image hashes", () => inRepository(async (dir) => {
  const source = await readFile(scanner, "utf8");
  const allowed = [...source.matchAll(/publicHex\("([0-9a-f]+)", "([0-9a-f]+)"\)/g)]
    .map((match) => match[1] + match[2]);
  assert.equal(allowed.length, 25); // Prior public image hashes, plus the graft settled-handler post-image and six observational-memory trigger images.
  for (const descriptor of DEPENDENCY_PATCHES) {
    assert.ok(allowed.includes(descriptor.before));
    assert.ok(allowed.includes(descriptor.after));
  }
  await track(dir, allowed.join("\n"));
  assert.equal(scan(dir).status, 0);
  commit(dir);
  assert.equal(scan(dir).status, 0, "public hashes also pass in historical patches");
}));

test("unknown hex fails and the scanner masks the value", () => inRepository(async (dir) => {
  await track(dir, unknownHex);
  const result = scan(dir);
  assert.equal(result.status, 1);
  assert.match(result.output, /Bare 40\+ hex/);
  assert.equal(result.output.includes(unknownHex), false);
}));

test("synthetic Tavily keys fail and are masked", () => inRepository(async (dir) => {
  await track(dir, tavilyKey);
  const result = scan(dir);
  assert.equal(result.status, 1);
  assert.match(result.output, /Tavily key/);
  assert.equal(result.output.includes(tavilyKey), false);
}));

test("a public hash used as an assigned secret is not exempt", () => inRepository(async (dir) => {
  const descriptor = DEPENDENCY_PATCHES.find((entry) => entry.patch === "pi-cursor-stale-ctx-0.5.2.patch")!;
  await track(dir, `API_KEY = "${descriptor.before}"`);
  const result = scan(dir);
  assert.equal(result.status, 1);
  assert.match(result.output, /Assigned secret-like value/);
}));

test("removed secrets still fail the full historical patch scan", () => inRepository(async (dir) => {
  await track(dir, `${unknownHex}\n${tavilyKey}`);
  commit(dir);
  await track(dir, "no current secrets\n");
  commit(dir);
  const result = scan(dir);
  assert.equal(result.status, 1);
  assert.match(result.output, /git history \(patches\).*Bare 40\+ hex/);
  assert.match(result.output, /git history \(patches\).*Tavily key/);
  assert.equal(result.output.includes(tavilyKey), false);
  assert.equal(result.output.includes(unknownHex), false);
}));
