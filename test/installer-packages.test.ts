import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BMAD_PACKAGE, configurePackagesAndKeys, assertGitAvailableForSpecs, gitMissingMessage } from "../installer/packages.mjs";
import { ensureEditGuardChildGate } from "../installer/edit-guard-child.mjs";
import {
  applyScoutChildLaunch,
  ensureChildHeader,
  ensureScoutChildLaunch,
  ensureScoutToolDiet,
  ensureSeparateThinkingFlag,
  ensureStderrOnlyChildLog,
  ensureViewerImport,
} from "../installer/scout-child.mjs";
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
  assert.ok(packages.includes("npm:@spences10/pi-themes"), "required npm:@spences10/pi-themes");
  assert.ok(packages.includes("npm:pi-context-view"), "required npm:pi-context-view");
  assert.ok(packages.includes("npm:@lucascardozo/pi-edit-guard"), "required npm:@lucascardozo/pi-edit-guard");
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

test("--yes does not install the BMAD bridge unless answers.packages names it", async () => {
  const skipped = await configurePackagesAndKeys({
    offline: true,
    yes: true,
  });
  assert.equal(skipped.packages.includes(BMAD_PACKAGE), false);
  assert.equal(BMAD_PACKAGE, "git:github.com/VisionCraft3r/ultimate-pi-bmad");
  assert.ok(skipped.packages.includes("npm:@plannotator/pi-extension"));
  assert.ok(skipped.packages.includes("npm:pi-cache-graph"));

  const chosen = await configurePackagesAndKeys({
    offline: true,
    yes: true,
    answers: { packages: [BMAD_PACKAGE] },
  });
  assert.ok(chosen.packages.includes(BMAD_PACKAGE));
  assert.equal(chosen.packages.filter((spec) => spec === BMAD_PACKAGE).length, 1);
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
    const required = [
      ROOT,
      SUBAGENTS,
      "npm:pi-lens",
      "npm:pi-graft",
      "npm:@spences10/pi-themes",
      "npm:pi-context-view",
      "npm:@lucascardozo/pi-edit-guard",
    ];
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

test("doctor accepts a relative local package spec, matching how `pi install <path>` stores it", async () => {
  const agentDir = await mkdtemp(path.join(tmpdir(), "ultimate-pi-doctor-relative-"));
  try {
    // `pi install <path>` records the spec relative to agentDir, not as an
    // absolute path — e.g. "../../Documents/UltimatePI/ultimate-pi". Doctor
    // must resolve that the same way pi does, not just handle absolute paths.
    const outsideRoot = await mkdtemp(path.join(tmpdir(), "ultimate-pi-relative-target-"));
    try {
      await writeFile(
        path.join(outsideRoot, "package.json"),
        `${JSON.stringify(
          {
            name: "ultimate-pi",
            pi: { extensions: ["./extensions/model-agents.ts"], skills: ["./skills"] },
          },
          null,
          2,
        )}\n`,
      );
      const relativeSpec = path.relative(agentDir, outsideRoot);
      await writeFile(
        path.join(agentDir, "settings.json"),
        `${JSON.stringify(
          {
            packages: [
              relativeSpec,
              SUBAGENTS,
              "npm:pi-lens",
              "npm:pi-graft",
              "npm:@spences10/pi-themes",
              "npm:pi-context-view",
              "npm:@lucascardozo/pi-edit-guard",
            ],
          },
          null,
          2,
        )}\n`,
      );

      const report = await doctor({ agentDir, offline: true });
      const check = report.checks.find((row) => row.label === "required packages");
      assert.equal(check?.ok, true, check?.detail);
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("doctor accepts a forked git origin when package.json name and pi manifest match", async () => {
  const agentDir = await mkdtemp(path.join(tmpdir(), "ultimate-pi-doctor-fork-"));
  try {
    const forkSpec = "git:github.com/anyone/renamed-pi";
    const forkRoot = path.join(agentDir, "git", "github.com", "anyone", "renamed-pi");
    await mkdir(forkRoot, { recursive: true });
    await writeFile(
      path.join(forkRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "ultimate-pi",
          pi: {
            extensions: ["./extensions/model-agents.ts"],
            skills: ["./skills"],
          },
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      path.join(agentDir, "settings.json"),
      `${JSON.stringify(
        {
          packages: [
            forkSpec,
            SUBAGENTS,
            "npm:pi-lens",
            "npm:pi-graft",
            "npm:@spences10/pi-themes",
            "npm:pi-context-view",
            "npm:@lucascardozo/pi-edit-guard",
          ],
        },
        null,
        2,
      )}\n`,
    );

    const report = await doctor({ agentDir, offline: true });
    const check = report.checks.find((row) => row.label === "required packages");
    assert.equal(check?.ok, true, check?.detail);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("doctor rejects a listed package whose name or pi manifest is not ultimate-pi", async () => {
  const agentDir = await mkdtemp(path.join(tmpdir(), "ultimate-pi-doctor-identity-"));
  try {
    const plausibleSpec = "git:github.com/anyone/ultimate-pi";
    const installRoot = path.join(agentDir, "git", "github.com", "anyone", "ultimate-pi");
    await mkdir(installRoot, { recursive: true });

    await writeFile(
      path.join(installRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "other-tool",
          pi: {
            extensions: ["./extensions/model-agents.ts"],
            skills: ["./skills"],
          },
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      path.join(agentDir, "settings.json"),
      `${JSON.stringify(
        { packages: [plausibleSpec, SUBAGENTS, "npm:pi-lens", "npm:pi-graft"] },
        null,
        2,
      )}\n`,
    );
    const wrongName = await doctor({ agentDir, offline: true });
    const wrongNameCheck = wrongName.checks.find((row) => row.label === "required packages");
    assert.equal(wrongNameCheck?.ok, false);
    assert.match(wrongNameCheck?.detail ?? "", /self missing from settings\.json/);

    await writeFile(
      path.join(installRoot, "package.json"),
      `${JSON.stringify({ name: "ultimate-pi", pi: { extensions: "./extensions" } }, null, 2)}\n`,
    );
    const wrongShape = await doctor({ agentDir, offline: true });
    const wrongShapeCheck = wrongShape.checks.find((row) => row.label === "required packages");
    assert.equal(wrongShapeCheck?.ok, false);
    assert.match(wrongShapeCheck?.detail ?? "", /self missing from settings\.json/);
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

const LAUNCHER_FIXTURE = `const CONTEXT_PACKAGES: { segments: string[]; tools: readonly string[] }[] = [
  {
    segments: ["npm", "node_modules", "@plannotator", "pi-extension"],
    tools: ["plannotator_submit_plan", "plannotator_mark_done"],
  },
];

export function contextExtensionsForChild(grantedTools: ReadonlySet<string>): { paths: string[]; tools: string[] } {
  const paths: string[] = [];
  const tools: string[] = [];
  for (const pkg of CONTEXT_PACKAGES) {
    const entries = ["ext.ts"];
    if (entries.length === 0) continue;
    paths.push(...entries);
    tools.push(...pkg.tools);
  }
  return { paths, tools };
}
`;

test("edit-guard child gate stays off a stock launcher and on the local context-package hook", () => {
  const stock = ensureEditGuardChildGate("export function launch() { return true; }\n");
  assert.equal(stock.status, "skipped");
  assert.match(stock.reason ?? "", /CONTEXT_PACKAGES absent/);

  const applied = ensureEditGuardChildGate(LAUNCHER_FIXTURE);
  assert.equal(applied.status, "applied");
  assert.match(applied.source, /whenTools: \["edit", "write"\]/);
  assert.match(applied.source, /pkg\.whenTools && !pkg\.whenTools\.some/);
  assert.equal(ensureEditGuardChildGate(applied.source).status, "already-applied");
});

const SANDBOX_FIXTURE = `    for (const extPath of extPaths) {
      parts.push("-e", shellEscape(extPath));
    }
  }
}
`;

test("scout child launch adds the budget inside the sandbox loop and not the lens flag", () => {
  const missing = ensureScoutChildLaunch("export function launch() { return true; }\n");
  assert.equal(missing.status, "skipped");

  const applied = ensureScoutChildLaunch(SANDBOX_FIXTURE);
  assert.equal(applied.status, "applied");
  assert.match(applied.source, /loadout\.agent === "scout"/);
  assert.doesNotMatch(applied.source, /--no-lens-context/);
  assert.match(applied.source, /scout-budget\.ts/);
  assert.match(applied.source, /loadout\.agent === "qa_tester"/);
  assert.match(applied.source, /qa-budget\.ts/);
  assert.equal(ensureScoutChildLaunch(applied.source).status, "already-applied");

  const headed = ensureChildHeader(applied.source);
  assert.equal(headed.status, "applied");
  assert.match(headed.source, /custom-header\.ts/);
  assert.equal(ensureChildHeader(headed.source).status, "already-applied");
});

test("a launcher that already has the scout branch gains the QA cap", () => {
  const scoutOnly = ensureScoutChildLaunch(SANDBOX_FIXTURE).source.replace(
    /\n {4}if \(loadout\.agent === "qa_tester"\) \{[\s\S]*?\n {4}\}\n/,
    "\n",
  );
  assert.doesNotMatch(scoutOnly, /qa-budget\.ts/);
  const upgraded = ensureScoutChildLaunch(scoutOnly);
  assert.equal(upgraded.status, "applied");
  assert.match(upgraded.source, /qa-budget\.ts/);
  assert.doesNotMatch(upgraded.source, /--no-lens-context/);
  assert.equal(ensureScoutChildLaunch(upgraded.source).status, "already-applied");
});

test("an installed launcher loses --no-lens-context", () => {
  const old = ensureScoutChildLaunch(SANDBOX_FIXTURE).source.replace(
    'if (loadout.agent === "scout") {\n',
    'if (loadout.agent === "scout") {\n      parts.push("--no-lens-context");\n',
  );
  assert.match(old, /--no-lens-context/);
  const migrated = ensureScoutChildLaunch(old);
  assert.equal(migrated.status, "applied");
  assert.doesNotMatch(migrated.source, /--no-lens-context/);
  assert.match(migrated.source, /scout-budget\.ts/);
  assert.equal(ensureScoutChildLaunch(migrated.source).status, "already-applied");
});

const THINKING_FIXTURE = `    const model = loadout.thinking ? \`\${loadout.model}:\${loadout.thinking}\` : loadout.model;
    parts.push("--model", shellEscape(model));
`;

test("thinking level is a flag and is not glued onto the model id", () => {
  const missing = ensureSeparateThinkingFlag("export function launch() { return true; }\n");
  assert.equal(missing.status, "skipped");
  const applied = ensureSeparateThinkingFlag(THINKING_FIXTURE);
  assert.equal(applied.status, "applied");
  assert.match(applied.source, /parts\.push\("--model", shellEscape\(loadout\.model\)\)/);
  assert.match(applied.source, /parts\.push\("--thinking", shellEscape\(loadout\.thinking\)\)/);
  assert.doesNotMatch(applied.source, /loadout\.model\}:\$\{loadout\.thinking/);
  assert.equal(ensureSeparateThinkingFlag(applied.source).status, "already-applied");
});

const DIET_FIXTURE = `export function contextExtensionsForChild(grantedTools: ReadonlySet<string>): { paths: string[]; tools: string[] } {
    if (pkg.whenTools && !pkg.whenTools.some((tool) => grantedTools.has(tool))) continue;
    paths.push(...entries);
    tools.push(...pkg.tools);
    const context = contextExtensionsForChild(granted);
}
`;

test("scout child context keeps two graft tools and drops pi-lens", () => {
  const missing = ensureScoutToolDiet("export function launch() { return true; }\n");
  assert.equal(missing.status, "skipped");
  const applied = ensureScoutToolDiet(DIET_FIXTURE);
  assert.equal(applied.status, "applied");
  assert.match(applied.source, /agent\?: string/);
  assert.match(applied.source, /pi-lens"\) continue/);
  assert.match(applied.source, /graft_find_code", "graft_repo_map"/);
  assert.match(applied.source, /contextExtensionsForChild\(granted, loadout\.agent\)/);
  assert.equal(ensureScoutToolDiet(applied.source).status, "already-applied");
});

const OLD_CHILD_LOG =
  "return `${child} >> ${shellEscape(logPath)} 2>&1; echo '__SUBAGENT_DONE_'$?'__'`;\n";
const FIXED_CHILD_LOG =
  "return `${child} 2>> ${shellEscape(logPath)}; echo '__SUBAGENT_DONE_'$?'__'`;\n";
const VIEWER_CALL = `import { partitionByParentSession } from "./shutdown-scope.ts";
viewerPromise = startViewer(viewerAgents)
`;

test("child log redirect keeps stdout on the pane and the viewer import stays attached", () => {
  assert.equal(ensureStderrOnlyChildLog("export function launch() { return true; }\n").status, "already-applied");
  const redirected = ensureStderrOnlyChildLog(OLD_CHILD_LOG);
  assert.equal(redirected.status, "applied");
  assert.match(redirected.source, /2>> \$\{shellEscape\(logPath\)\}/);
  assert.doesNotMatch(redirected.source, /2>&1/);
  assert.equal(ensureStderrOnlyChildLog(redirected.source).status, "already-applied");
  assert.equal(ensureStderrOnlyChildLog(FIXED_CHILD_LOG).status, "already-applied");

  assert.equal(ensureViewerImport("export function launch() { return true; }\n").status, "already-applied");
  const imported = ensureViewerImport(VIEWER_CALL);
  assert.equal(imported.status, "applied");
  assert.match(imported.source, /from "\.\/viewer\.ts"/);
  assert.match(imported.source, /startViewer,/);
  assert.match(imported.source, /renderAgentDocument,/);
  assert.equal(ensureViewerImport(imported.source).status, "already-applied");
});

test("child launcher repairs a temporary installation and is idempotent", async () => {
  const agentDir = await mkdtemp(path.join(tmpdir(), "upi-child-launcher-"));
  const launcher = path.join(agentDir, "git", "github.com", "amosblomqvist",
    "pi-interactive-subagents", "pi-extension", "subagents", "index.ts");
  try {
    await mkdir(path.dirname(launcher), { recursive: true });
    await writeFile(launcher, VIEWER_CALL + OLD_CHILD_LOG + THINKING_FIXTURE + DIET_FIXTURE + SANDBOX_FIXTURE);
    const repaired = await applyScoutChildLaunch(agentDir);
    assert.equal(repaired.status, "applied");
    assert.equal(repaired.reason, undefined);
    const source = await readFile(launcher, "utf8");
    assert.equal(ensureStderrOnlyChildLog(source).status, "already-applied");
    assert.equal(ensureViewerImport(source).status, "already-applied");
    assert.equal(ensureChildHeader(source).status, "already-applied");
    assert.equal((await applyScoutChildLaunch(agentDir)).status, "already-applied");
    assert.equal(await readFile(launcher, "utf8"), source);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});
