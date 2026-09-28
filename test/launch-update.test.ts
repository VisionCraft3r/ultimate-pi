import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyNpmUpdate, copySource, gitCheckoutDir, nonNpmPackageNote, npmPackageName, parsePiVersion, plannotatorUpdateAllowed, versionAtLeast } from "../lib/launch-update.ts";
import { copyExtensionTree, isExtensionFactorySource, unsafeExtensionEntries } from "../lib/extension-layout.ts";
import { formatSidecarQuestion } from "../lib/question-helpers.ts";
import { writeAskSidecar } from "../lib/planner-handoff.ts";

test("npm updates skip majors and patched pins", () => {
  assert.equal(classifyNpmUpdate("0.27.18", "0.27.19", "@plannotator/pi-extension"), "apply");
  assert.equal(classifyNpmUpdate("0.27.18", "1.0.0", "@plannotator/pi-extension"), "skip-major");
  assert.equal(classifyNpmUpdate("0.5.2", "0.5.3", "@schultzp2020/pi-cursor"), "skip-patch-pin");
  assert.equal(classifyNpmUpdate("0.5.2", "0.5.2", "@schultzp2020/pi-cursor"), "current");
  assert.equal(parsePiVersion("0.87.1\n"), "0.87.1");
  assert.equal(versionAtLeast("0.87.1", "0.79.1"), true);
  assert.equal(plannotatorUpdateAllowed("@plannotator/pi-extension", "0.70.0"), false);
  assert.equal(plannotatorUpdateAllowed("pi-lens", "0.70.0"), true);
});

test("versioned npm specs resolve to the installed package name", () => {
  assert.equal(npmPackageName("npm:pi-lens@4.3.0"), "pi-lens");
  assert.equal(npmPackageName("npm:@gotgenes/pi-anthropic-auth@3.3.2"), "@gotgenes/pi-anthropic-auth");
  assert.equal(npmPackageName("npm:@plannotator/pi-extension@0.27.20"), "@plannotator/pi-extension");
  assert.equal(npmPackageName("npm:pi-graft"), "pi-graft");
  assert.equal(npmPackageName("git:github.com/amosblomqvist/pi-interactive-subagents"), null);
});

test("installed git checkouts stay quiet and missing ones are reported", () => {
  const root = mkdtempSync(join(tmpdir(), "upi-git-"));
  const spec = "git:github.com/amosblomqvist/pi-interactive-subagents@c3e8b53c0754ae5ccc19fdab5a7481ec039bc2f7";
  const checkout = gitCheckoutDir(root, spec);
  assert.equal(checkout, join(root, "git", "github.com", "amosblomqvist", "pi-interactive-subagents"));
  assert.equal(nonNpmPackageNote(root, spec), `skipped ${spec}; not installed`);
  mkdirSync(checkout!, { recursive: true });
  assert.equal(nonNpmPackageNote(root, spec), null);
  assert.equal(nonNpmPackageNote(root, "/tmp/local-package"), null);
  rmSync(root, { recursive: true, force: true });
});

test("extension sync skips helpers Pi would try to load", () => {
  const root = mkdtempSync(join(tmpdir(), "upi-ext-"));
  const from = join(root, "from");
  const to = join(root, "to");
  mkdirSync(from, { recursive: true });
  writeFileSync(join(from, "helper.ts"), "export function helper() { return 1; }\n");
  writeFileSync(join(from, "real.ts"), "export default function real(pi) { void pi; }\n");
  const skipped = copyExtensionTree(from, to);
  assert.deepEqual(skipped, ["helper.ts"]);
  assert.equal(exists(join(to, "real.ts")), true);
  assert.equal(exists(join(to, "helper.ts")), false);
  assert.equal(isExtensionFactorySource(readFileSync(join(from, "real.ts"), "utf8")), true);
  assert.deepEqual(unsafeExtensionEntries(from), ["helper.ts"]);
  rmSync(root, { recursive: true, force: true });
});

function exists(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

test("skill sync leaves the ignore file that turns skills off", () => {
  const root = mkdtempSync(join(tmpdir(), "upi-skills-"));
  const source = join(root, "source");
  const dest = join(root, "dest");
  mkdirSync(join(source, "skills", "pdf-reader"), { recursive: true });
  writeFileSync(join(source, "skills", "pdf-reader", "SKILL.md"), "---\nname: pdf-reader\n---\n");
  mkdirSync(join(dest, "skills", "pdf-reader"), { recursive: true });
  writeFileSync(join(dest, "skills", ".ignore"), "pdf-reader/\n");
  writeFileSync(join(dest, "skills", "pdf-reader", "SKILL.md"), "---\nname: pdf-reader\n---\n");
  copySource(source, dest);
  assert.equal(readFileSync(join(dest, "skills", ".ignore"), "utf8"), "pdf-reader/\n");
  assert.equal(exists(join(dest, "skills", "pdf-reader", "SKILL.md")), true);
  rmSync(root, { recursive: true, force: true });
});

test("a subagent parks the question in the ask sidecar", () => {
  const root = mkdtempSync(join(tmpdir(), "upi-ask-"));
  const session = join(root, "session.jsonl");
  writeFileSync(session, "");
  const previous = {
    session: process.env.PI_SUBAGENT_SESSION,
    name: process.env.PI_SUBAGENT_NAME,
    agent: process.env.PI_SUBAGENT_AGENT,
  };
  process.env.PI_SUBAGENT_SESSION = session;
  process.env.PI_SUBAGENT_NAME = "billing-portal-planner";
  process.env.PI_SUBAGENT_AGENT = "planner";
  try {
    const question = formatSidecarQuestion({
      question: "How should the spec be grounded?",
      details: "The workspace has no source code.",
      options: [
        { label: "Greenfield: Next.js", description: "Document the stack in the spec." },
        { label: "Stack-agnostic spec" },
      ],
    });
    assert.match(question, /The workspace has no source code/);
    assert.match(question, /^- Greenfield: Next\.js — Document the stack in the spec\.$/m);
    assert.match(question, /^- Other$/m);
    assert.equal(writeAskSidecar(question), true);
    const parked = JSON.parse(readFileSync(`${session}.ask`, "utf8")) as { name?: string; question?: string };
    assert.equal(parked.name, "billing-portal-planner");
    assert.equal(parked.question, question);
  } finally {
    if (previous.session === undefined) delete process.env.PI_SUBAGENT_SESSION;
    else process.env.PI_SUBAGENT_SESSION = previous.session;
    if (previous.name === undefined) delete process.env.PI_SUBAGENT_NAME;
    else process.env.PI_SUBAGENT_NAME = previous.name;
    if (previous.agent === undefined) delete process.env.PI_SUBAGENT_AGENT;
    else process.env.PI_SUBAGENT_AGENT = previous.agent;
    rmSync(root, { recursive: true, force: true });
  }
});
