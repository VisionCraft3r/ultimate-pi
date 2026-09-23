import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configurePackagesAndKeys, assertGitAvailableForSpecs, gitMissingMessage } from "../installer/packages.mjs";
import { doctor } from "../installer/doctor.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUBAGENTS =
  "git:github.com/amosblomqvist/pi-interactive-subagents@c3e8b53c0754ae5ccc19fdab5a7481ec039bc2f7";

test("offline --yes with empty answers.packages still installs required lens, graft, and subagents", async () => {
  const { packages } = await configurePackagesAndKeys({
    offline: true,
    yes: true,
    answers: { packages: [] },
  });

  assert.ok(packages.includes("npm:pi-lens"), "required npm:pi-lens");
  assert.ok(packages.includes("npm:pi-graft"), "required npm:pi-graft");
  assert.ok(packages.includes(SUBAGENTS), "required pinned interactive-subagents");
  assert.ok(packages.includes(ROOT), "self spec is checkout ROOT");
  assert.equal(path.isAbsolute(ROOT), true);
  assert.equal(
    packages.includes("npm:@plannotator/pi-extension"),
    false,
    "empty answers omits optional plannotator",
  );
  assert.equal(
    packages.includes("npm:pi-cache-graph"),
    false,
    "empty answers omits optional cache-graph",
  );

  const overlap = await configurePackagesAndKeys({
    offline: true,
    yes: true,
    answers: { packages: ["npm:pi-lens", "npm:pi-graft", SUBAGENTS] },
  });
  assert.equal(overlap.packages.filter((spec) => spec === "npm:pi-lens").length, 1);
  assert.equal(overlap.packages.filter((spec) => spec === "npm:pi-graft").length, 1);
  assert.equal(overlap.packages.filter((spec) => spec === SUBAGENTS).length, 1);
});

test("rejects bare answers.packages names before any pi install", async () => {
  await assert.rejects(
    () =>
      configurePackagesAndKeys({
        offline: true,
        yes: true,
        answers: { packages: ["pi-interactive-subagents"] },
      }),
    (error) => {
      assert.match(String(error), /before pi install/);
      assert.match(String(error), /pi-interactive-subagents/);
      assert.match(String(error), /documented Pi source specs/);
      return true;
    },
  );
});

test("doctor --offline checks settings source specs and ✖ when lens or graft is missing", async () => {
  const agentDir = await mkdtemp(path.join(tmpdir(), "ultimate-pi-doctor-packages-"));
  try {
    const required = [ROOT, SUBAGENTS, "npm:pi-lens", "npm:pi-graft"];
    await writeFile(
      path.join(agentDir, "settings.json"),
      `${JSON.stringify({ packages: required }, null, 2)}\n`,
    );
    const present = await doctor({ agentDir, offline: true });
    const presentCheck = present.checks.find((check) => check.label === "required packages");
    assert.equal(presentCheck?.ok, true, presentCheck?.detail);

    await writeFile(
      path.join(agentDir, "settings.json"),
      `${JSON.stringify({ packages: [ROOT, SUBAGENTS, "pi-lens", "pi-graft"] }, null, 2)}\n`,
    );
    const missing = await doctor({ agentDir, offline: true });
    const missingCheck = missing.checks.find((check) => check.label === "required packages");
    assert.equal(missingCheck?.ok, false);
    assert.match(missingCheck?.detail ?? "", /npm:pi-lens missing from settings\.json/);
    assert.match(missingCheck?.detail ?? "", /npm:pi-graft missing from settings\.json/);
    assert.doesNotMatch(missingCheck?.detail ?? "", /listed but not installed/);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("doctor empty auth.json tells the user to pi login then re-run install", async () => {
  const agentDir = await mkdtemp(path.join(tmpdir(), "ultimate-pi-doctor-auth-"));
  try {
    const report = await doctor({ agentDir, offline: true });
    const authCheck = report.checks.find((check) => check.label === "provider auth");
    assert.equal(authCheck?.ok, false);
    assert.match(authCheck?.detail ?? "", /no providers configured/);
    assert.match(authCheck?.detail ?? "", /pi login/);
    assert.match(authCheck?.detail ?? "", /ultimate-pi setup providers/);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("assertGitAvailableForSpecs fails clearly when git is missing for a git: package", () => {
  assert.throws(
    () =>
      assertGitAvailableForSpecs(
        ["git:github.com/amosblomqvist/pi-interactive-subagents@abc"],
        {},
        () => false,
      ),
    (error) => {
      assert.match(String(error), /git is required/);
      assert.match(String(error), /pi-interactive-subagents/);
      assert.match(String(error), /cannot be skipped/);
      assert.doesNotMatch(String(error), /--minimal/);
      return true;
    },
  );
});

test("assertGitAvailableForSpecs skips the check when offline, dry-run, or no git: specs", () => {
  assert.doesNotThrow(() =>
    assertGitAvailableForSpecs(["git:github.com/example/pkg"], { offline: true }, () => false),
  );
  assert.doesNotThrow(() =>
    assertGitAvailableForSpecs(["git:github.com/example/pkg"], { dryRun: true }, () => false),
  );
  assert.doesNotThrow(() =>
    assertGitAvailableForSpecs(["npm:pi-lens", "npm:pi-graft"], {}, () => false),
  );
});

test("gitMissingMessage for optional-only git packages points at answers.packages, not a new flag", () => {
  const message = gitMissingMessage(["git:github.com/amosblomqvist/pi-observational-memory"]);
  assert.match(message, /optional git-based package/);
  assert.match(message, /answers\.packages/);
  assert.doesNotMatch(message, /--minimal/);
});
