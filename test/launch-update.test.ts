import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyNpmUpdate, copySource, gitCheckoutDir, isSubagentSession, mapWithCap, nonNpmPackageNote, npmCheckDue, npmPackageName, parsePiVersion, plannotatorUpdateAllowed, versionAtLeast } from "../lib/launch-update.ts";
import { copyExtensionTree, isExtensionFactorySource, unsafeExtensionEntries } from "../lib/extension-layout.ts";
import { formatAnswers, formatSidecarQuestion, paperclipEnv, parseSubagentQuestion, questionsFromAsk } from "../lib/paperclip-questions.ts";
import { writeAskSidecar } from "../lib/planner-handoff.ts";

test("npm updates skip majors and patched pins", () => {
  assert.equal(classifyNpmUpdate("0.27.18", "0.27.19", "@plannotator/pi-extension"), "apply");
  assert.equal(classifyNpmUpdate("0.27.18", "1.0.0", "@plannotator/pi-extension"), "skip-major");
  assert.equal(classifyNpmUpdate("0.5.2", "0.5.3", "@schultzp2020/pi-cursor"), "skip-patch-pin");
  assert.equal(classifyNpmUpdate("0.5.2", "0.5.2", "@schultzp2020/pi-cursor"), "current");
  assert.equal(classifyNpmUpdate("0.1.2", "0.2.0", "pi-graft"), "skip-patch-pin");
  assert.equal(parsePiVersion("0.87.1\n"), "0.87.1");
  assert.equal(versionAtLeast("0.87.1", "0.79.1"), true);
  assert.equal(plannotatorUpdateAllowed("@plannotator/pi-extension", "0.70.0"), false);
  assert.equal(plannotatorUpdateAllowed("pi-lens", "0.70.0"), true);
});

test("mapWithCap keeps result order and limits how many run at once", async () => {
  let active = 0;
  let max = 0;
  const out = await mapWithCap([1, 2, 3, 4, 5, 6, 7], 4, async (n) => {
    active += 1;
    max = Math.max(max, active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    active -= 1;
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14]);
  assert.equal(max <= 4, true);
  assert.equal(max > 1, true);
  assert.deepEqual(await mapWithCap([], 4, async (n: number) => n), []);
});

test("subagent sessions skip launch update and npm checks wait six hours", () => {
  assert.equal(isSubagentSession({ PI_SUBAGENT_AGENT: "worker" } as NodeJS.ProcessEnv), true);
  assert.equal(isSubagentSession({ PI_SUBAGENT_DEPTH: "2" } as NodeJS.ProcessEnv), true);
  assert.equal(isSubagentSession({} as NodeJS.ProcessEnv), false);
  const now = Date.parse("2026-09-30T12:00:00Z");
  assert.equal(npmCheckDue(undefined, now), true);
  assert.equal(npmCheckDue("not-a-date", now), true);
  assert.equal(npmCheckDue("2026-09-30T11:00:00Z", now), false);
  assert.equal(npmCheckDue("2026-09-30T05:00:00Z", now), true);
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

test("subagent questions become a Paperclip choice with Other", () => {
  const parsed = parseSubagentQuestion('Sub-agent "planner" asks (4s):\n\nKeep the old name?\n\nReply with subagent_message({ name: "planner", message: "…" })');
  assert.equal(parsed?.name, "planner");
  assert.equal(parsed?.question, "Keep the old name?");
  const questions = questionsFromAsk({
    question: "Which layout?",
    options: [{ label: "Grid" }, { label: "List" }],
  });
  assert.equal(questions[0]?.allowOther, true);
  assert.equal(questions[0]?.options.length, 2);
  assert.equal(formatAnswers(questions, [{ questionId: "q1", optionIds: ["grid"], otherText: "cards" }]), "Grid — cards");
});

test("a subagent without Paperclip env parks the question in the ask sidecar", () => {
  const root = mkdtempSync(join(tmpdir(), "upi-ask-"));
  const session = join(root, "session.jsonl");
  writeFileSync(session, "");
  const previous = {
    session: process.env.PI_SUBAGENT_SESSION,
    name: process.env.PI_SUBAGENT_NAME,
    agent: process.env.PI_SUBAGENT_AGENT,
    api: process.env.PAPERCLIP_API_URL,
    key: process.env.PAPERCLIP_API_KEY,
    task: process.env.PAPERCLIP_TASK_ID,
  };
  delete process.env.PAPERCLIP_API_URL;
  delete process.env.PAPERCLIP_API_KEY;
  delete process.env.PAPERCLIP_TASK_ID;
  process.env.PI_SUBAGENT_SESSION = session;
  process.env.PI_SUBAGENT_NAME = "billing-portal-planner";
  process.env.PI_SUBAGENT_AGENT = "planner";
  try {
    assert.equal(paperclipEnv(), null);
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
    if (previous.api === undefined) delete process.env.PAPERCLIP_API_URL;
    else process.env.PAPERCLIP_API_URL = previous.api;
    if (previous.key === undefined) delete process.env.PAPERCLIP_API_KEY;
    else process.env.PAPERCLIP_API_KEY = previous.key;
    if (previous.task === undefined) delete process.env.PAPERCLIP_TASK_ID;
    else process.env.PAPERCLIP_TASK_ID = previous.task;
    rmSync(root, { recursive: true, force: true });
  }
});
