import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { parseArgs } from "../bin/ultimate-pi.mjs";
import { setup } from "../installer/index.mjs";
import { BMAD_PACKAGE } from "../installer/packages.mjs";
import { SETUP_TOPICS } from "../installer/topics.mjs";

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

test("setup packages is a topic, and --yes leaves the BMAD bridge out", () => {
  const topics = SETUP_TOPICS.join("|");
  assert.match(spawnCli(["--help"]).stdout, new RegExp(`setup <${topics.replaceAll("|", "\\|")}>`));
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const template = readFileSync(new URL("../templates/AGENTS.md.tmpl", import.meta.url), "utf8");
  assert.ok(readme.includes(topics));
  assert.ok(template.includes(topics));

  const parsed = parseArgs(["setup", "packages", "--yes", "--offline", "--dry-run"]);
  assert.equal(parsed.command, "setup");
  assert.equal(parsed.setupTopic, "packages");

  const unknown = spawnCli(["setup", "nope", "--offline"]);
  assert.equal(unknown.status, 1);
  assert.match(`${unknown.stdout}\n${unknown.stderr}`, /packages/);

  const agentDir = mkdtempSync(join(tmpdir(), "ultimate-pi-setup-packages-"));
  try {
    const skipped = spawnCli(["setup", "packages", "--yes", "--offline", "--dry-run", "--agent-dir", agentDir]);
    const skippedText = `${skipped.stdout}\n${skipped.stderr}`;
    assert.equal(skipped.status, 0, skippedText);
    assert.match(skippedText, /\[offline\] pi install npm:pi-lens/);
    assert.match(skippedText, /BMAD bridge: not selected/);
    assert.equal(skippedText.includes(BMAD_PACKAGE), false);
    assert.equal(existsSync(join(agentDir, "settings.json")), false);
    assert.equal(existsSync(join(agentDir, "auth.json")), false);

    const answers = join(agentDir, "answers.json");
    writeFileSync(
      answers,
      `${JSON.stringify({ providers: [], agentAssignments: {}, packages: [BMAD_PACKAGE] })}\n`,
    );
    const chosen = spawnCli([
      "setup",
      "packages",
      "--yes",
      "--offline",
      "--dry-run",
      "--agent-dir",
      agentDir,
      "--answers",
      answers,
    ]);
    const chosenText = `${chosen.stdout}\n${chosen.stderr}`;
    assert.equal(chosen.status, 0, chosenText);
    assert.match(chosenText, new RegExp(`\\[offline\\] pi install ${BMAD_PACKAGE.replaceAll("/", "\\/")}`));
    assert.match(chosenText, /BMAD bridge: selected/);
    assert.equal(existsSync(join(agentDir, "auth.json")), false);
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("setup() rejects a topic the CLI list does not contain", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "ultimate-pi-setup-unknown-"));
  try {
    const result = await setup({
      setupTopic: "nope",
      agentDir,
      yes: true,
      offline: true,
      dryRun: true,
    });
    assert.equal(result, 1);
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
