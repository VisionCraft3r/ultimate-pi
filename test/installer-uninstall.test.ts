import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBackupSession } from "../installer/backup.mjs";
import {
  removeUltimatePiPackage,
  runPiRemove,
} from "../installer/uninstall-package.mjs";
import { removeManagedAgentProfiles } from "../installer/uninstall-managed.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLISHED = "git:github.com/VisionCraft3r/ultimate-pi";
const SUBAGENTS =
  "git:github.com/amosblomqvist/pi-interactive-subagents@c3e8b53c0754ae5ccc19fdab5a7481ec039bc2f7";
const AUTH_BYTES = '{"anthropic":{"type":"oauth","keep":"bytes"}}\n';

async function makeTempDir() {
  return mkdtemp(path.join(tmpdir(), "ultimate-pi-uninstall-pkg-"));
}

function settingsPayload() {
  return {
    theme: "dark",
    enabledModels: ["cursor/grok-4.5"],
    customFlag: true,
    packages: [
      ROOT,
      "npm:pi-lens",
      "npm:pi-graft",
      SUBAGENTS,
      PUBLISHED,
      "npm:pi-cache-graph",
    ],
  };
}

function refuseBackup() {
  return {
    backupIfExists: async () => {
      throw new Error("backup must not run");
    },
  };
}

test("removeUltimatePiPackage strips checkout and published self sources, preserving other packages, settings, auth, and a settings backup", async () => {
  const dir = await makeTempDir();
  try {
    const originalSettings = `${JSON.stringify(settingsPayload(), null, 2)}\n`;
    await writeFile(path.join(dir, "settings.json"), originalSettings);
    await writeFile(path.join(dir, "auth.json"), AUTH_BYTES);

    const backupSession = createBackupSession(dir);
    const result = await removeUltimatePiPackage(dir, backupSession);

    assert.deepEqual([...result.removed].sort(), [ROOT, PUBLISHED].sort());
    assert.deepEqual(result.packages, [
      "npm:pi-lens",
      "npm:pi-graft",
      SUBAGENTS,
      "npm:pi-cache-graph",
    ]);

    const next = JSON.parse(await readFile(path.join(dir, "settings.json"), "utf8"));
    assert.equal(next.theme, "dark");
    assert.deepEqual(next.enabledModels, ["cursor/grok-4.5"]);
    assert.equal(next.customFlag, true);
    assert.deepEqual(next.packages, result.packages);
    assert.equal(next.packages.includes(ROOT), false);
    assert.equal(next.packages.includes(PUBLISHED), false);
    assert.ok(next.packages.includes("npm:pi-lens"));
    assert.ok(next.packages.includes("npm:pi-graft"));
    assert.ok(next.packages.includes(SUBAGENTS));

    assert.equal(await readFile(path.join(dir, "auth.json"), "utf8"), AUTH_BYTES);

    const backed = await readFile(path.join(backupSession.dir, "settings.json"));
    assert.deepEqual(backed, Buffer.from(originalSettings));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("removeUltimatePiPackage dry-run reports removals and writes nothing", async () => {
  const dir = await makeTempDir();
  try {
    const originalSettings = `${JSON.stringify(settingsPayload(), null, 2)}\n`;
    await writeFile(path.join(dir, "settings.json"), originalSettings);
    await writeFile(path.join(dir, "auth.json"), AUTH_BYTES);
    const before = (await readdir(dir)).sort();

    const result = await removeUltimatePiPackage(dir, refuseBackup(), { dryRun: true });

    assert.equal(result.dryRun, true);
    assert.deepEqual([...result.removed].sort(), [ROOT, PUBLISHED].sort());
    assert.deepEqual(result.packages, [
      "npm:pi-lens",
      "npm:pi-graft",
      SUBAGENTS,
      "npm:pi-cache-graph",
    ]);
    assert.equal(await readFile(path.join(dir, "settings.json"), "utf8"), originalSettings);
    assert.equal(await readFile(path.join(dir, "auth.json"), "utf8"), AUTH_BYTES);
    assert.deepEqual((await readdir(dir)).sort(), before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("removeUltimatePiPackage throws on malformed settings and does not write", async () => {
  const dir = await makeTempDir();
  try {
    const malformed = "{ this is not json\n";
    await writeFile(path.join(dir, "settings.json"), malformed);
    await writeFile(path.join(dir, "auth.json"), AUTH_BYTES);

    await assert.rejects(
      () => removeUltimatePiPackage(dir, refuseBackup()),
      /malformed settings\.json: not valid JSON/,
    );
    assert.equal(await readFile(path.join(dir, "settings.json"), "utf8"), malformed);
    assert.equal(await readFile(path.join(dir, "auth.json"), "utf8"), AUTH_BYTES);

    const nonStringPackages = `${JSON.stringify({ theme: "keep", packages: ["npm:pi-lens", 12] }, null, 2)}\n`;
    await writeFile(path.join(dir, "settings.json"), nonStringPackages);
    await assert.rejects(
      () => removeUltimatePiPackage(dir, refuseBackup()),
      /malformed settings\.json: packages must be an array of strings/,
    );
    assert.equal(await readFile(path.join(dir, "settings.json"), "utf8"), nonStringPackages);
    assert.equal(await readFile(path.join(dir, "auth.json"), "utf8"), AUTH_BYTES);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runPiRemove spawns pi remove with source, --local, and PI_CODING_AGENT_DIR via PATH stub", async () => {
  const dir = await makeTempDir();
  const originalPath = process.env.PATH;
  try {
    const recordFile = path.join(dir, "pi-invocation.json");
    await writeFile(
      path.join(dir, "pi"),
      `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
writeFileSync(${JSON.stringify(recordFile)}, JSON.stringify({
  argv: process.argv.slice(2),
  PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
}));
`,
    );
    await chmod(path.join(dir, "pi"), 0o755);
    process.env.PATH = `${dir}${path.delimiter}${originalPath ?? ""}`;

    await runPiRemove(PUBLISHED, { agentDir: dir, local: true });

    const recorded = JSON.parse(await readFile(recordFile, "utf8"));
    assert.deepEqual(recorded.argv, ["remove", PUBLISHED, "--local"]);
    assert.equal(recorded.PI_CODING_AGENT_DIR, dir);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await rm(dir, { recursive: true, force: true });
  }
});

test("default uninstall still leaves third-party packages, model-agents.json, enabledModels, and auth.json", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(path.join(dir, "settings.json"), `${JSON.stringify(settingsPayload(), null, 2)}\n`);
    await writeFile(path.join(dir, "auth.json"), AUTH_BYTES);
    await writeFile(path.join(dir, "model-agents.json"), `${JSON.stringify({ fallbacks: {} }, null, 2)}\n`);

    const result = await removeUltimatePiPackage(dir, createBackupSession(dir));
    assert.ok(result.packages.includes("npm:pi-lens"));
    assert.ok(result.packages.includes(SUBAGENTS));
    assert.equal(result.modelAgentsRemoved, undefined);

    const settings = JSON.parse(await readFile(path.join(dir, "settings.json"), "utf8"));
    assert.deepEqual(settings.enabledModels, ["cursor/grok-4.5"]);
    assert.ok(settings.packages.includes("npm:pi-lens"));
    assert.equal(await readFile(path.join(dir, "auth.json"), "utf8"), AUTH_BYTES);
    assert.match(await readFile(path.join(dir, "model-agents.json"), "utf8"), /fallbacks/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--full / --purge strips third-party packages and model-agents.json but never auth.json", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(path.join(dir, "settings.json"), `${JSON.stringify(settingsPayload(), null, 2)}\n`);
    await writeFile(path.join(dir, "auth.json"), AUTH_BYTES);
    await writeFile(
      path.join(dir, "model-agents.json"),
      `${JSON.stringify({ fallbacks: { cursor: [] }, agentFallbacks: {} }, null, 2)}\n`,
    );

    const backupSession = createBackupSession(dir);
    const result = await removeUltimatePiPackage(dir, backupSession, { full: true });

    assert.ok(result.removed.includes(ROOT));
    assert.ok(result.removed.includes(PUBLISHED));
    assert.ok(result.removed.includes("npm:pi-lens"));
    assert.ok(result.removed.includes("npm:pi-graft"));
    assert.ok(result.removed.includes(SUBAGENTS));
    assert.ok(result.removed.includes("npm:pi-cache-graph"));
    assert.deepEqual(result.packages, []);
    assert.equal(result.modelAgentsRemoved, true);
    assert.match(result.backupsNote ?? "", /backups/);

    const next = JSON.parse(await readFile(path.join(dir, "settings.json"), "utf8"));
    assert.deepEqual(next.enabledModels, ["cursor/grok-4.5"]);
    assert.deepEqual(next.packages, []);
    assert.equal(await readFile(path.join(dir, "auth.json"), "utf8"), AUTH_BYTES);
    await assert.rejects(() => readFile(path.join(dir, "model-agents.json"), "utf8"), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("full uninstall via managed profiles reports remaining backups and leaves auth.json", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(path.join(dir, "auth.json"), AUTH_BYTES);
    await writeFile(path.join(dir, "model-agents.json"), `${JSON.stringify({ fallbacks: {} }, null, 2)}\n`);
    const backupSession = createBackupSession(dir);
    await backupSession.backupIfExists("auth.json");

    const result = await removeManagedAgentProfiles(dir, backupSession, { full: true });
    assert.equal(result.modelAgentsRemoved, true);
    assert.ok((result.backupsNote ?? "").includes(dir));
    assert.match(result.backupsNote ?? "", /backups/);
    assert.equal(await readFile(path.join(dir, "auth.json"), "utf8"), AUTH_BYTES);
    await assert.rejects(() => readFile(path.join(dir, "model-agents.json"), "utf8"), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
