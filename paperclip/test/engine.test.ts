import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { listPersonas, parsePersonaMarkdown } from "../src/personas.ts";
import { assertInScope, replaceModelLine, replaceThinkingLine, writeEnabledModels, writePersonaModel, writePersonaThinking, writeProviderFallback } from "../src/scope.ts";
import { agentIdFromSession, buildPiArgs, paperclipChildEnv, parkedPaneTarget, parsePaneList, parseSessionList, parseSubagentScript, resolvePiBinary, sessionName, subagentNamesBySurface, tmuxNewSessionArgs } from "../src/launch.ts";
import { deliverableSummary, extensionStartupError, parsePiJsonl } from "../src/parse.ts";
import { orchestratorPersona } from "../src/personas.ts";
import { chmodSync } from "node:fs";
import { chooseRunDisposition, execute, mirroredSkipResult, readPaperclipInstructions, recordRunDisposition, releaseMirrorIssue, runPrompt, runWorkingDirectory } from "../src/server/execute.ts";
import { assignmentInstructions, planOrgSync } from "../src/org.ts";
import { patchBundleText } from "../scripts/patch-paperclip-ui.mjs";
import { skillSnapshot, syncSkillSelection } from "../src/pi-skills.ts";
import { prepareProjectFolder, projectFolderName } from "../src/project-folder.ts";
import { readFileSync as readText } from "node:fs";

const dir = mkdtempSync(join(tmpdir(), "upi-paperclip-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("paperclip child env carries the issue id and api url", () => {
  const env = paperclipChildEnv({
    agentId: "agent-1",
    companyId: "company-1",
    runId: "run-1",
    authToken: "token",
    agentDir: "/tmp/agent",
    context: { issueId: "issue-1" },
  });
  assert.equal(env.PAPERCLIP_TASK_ID, "issue-1");
  assert.equal("PAPERCLIP_PI_PROVIDERS" in env, false);
  const withExtra = paperclipChildEnv({
    agentId: "agent-1",
    companyId: "company-1",
    runId: "run-1",
    agentDir: "/tmp/agent",
    context: {},
    extraEnv: { FOO: "bar", PAPERCLIP_PI_PROVIDERS: "/elsewhere", PI_CODING_AGENT_DIR: "/hijack" },
  });
  assert.equal(withExtra.FOO, "bar");
  assert.equal("PAPERCLIP_PI_PROVIDERS" in withExtra, false);
  assert.equal(withExtra.PI_CODING_AGENT_DIR, "/tmp/agent");
  assert.equal(env.PAPERCLIP_API_KEY, "token");
  assert.match(env.PAPERCLIP_API_URL, /^http:\/\//);
});

test("session name is tmux-safe and pi args scope orchestrator without --tools", () => {
  assert.equal(sessionName("agent/1"), "paperclip-agent1");
  const args = buildPiArgs({
    persona: orchestratorPersona(),
    scopedModels: ["cursor/cursor-grok-4.6-medium", "anthropic/claude-sonnet-5"],
    systemPrompt: "route",
    userPrompt: "fix the bug",
    sessionFile: "/tmp/session.jsonl",
  });
  assert.equal(args.includes("--model"), false);
  assert.equal(args.includes("--tools"), false);
  assert.equal(args.includes("--no-extensions"), false);
  const selected = buildPiArgs({
    persona: { ...orchestratorPersona(), model: "anthropic/claude-sonnet-5", thinking: "medium" },
    scopedModels: ["anthropic/claude-sonnet-5"],
    systemPrompt: "route",
    userPrompt: "fix the bug",
    sessionFile: "/tmp/session.jsonl",
  });
  assert.equal(selected[selected.indexOf("--provider") + 1], "anthropic");
  assert.equal(selected[selected.indexOf("--model") + 1], "claude-sonnet-5");
  assert.equal(selected[selected.indexOf("--thinking") + 1], "medium");
  assert.equal(selected.includes("--tools"), false);
  assert.deepEqual(args.slice(args.indexOf("--models"), args.indexOf("--models") + 2), [
    "--models",
    "cursor/cursor-grok-4.6-medium,anthropic/claude-sonnet-5",
  ]);
  const persona = parsePersonaMarkdown("scout", "---\nname: scout\nmodel: cursor/cursor-grok-4.6-medium\nthinking: medium\ntools: read, grep\n---\nbody\n", "installed");
  const scoutArgs = buildPiArgs({
    persona,
    scopedModels: ["cursor/cursor-grok-4.6-medium"],
    systemPrompt: "body",
    userPrompt: "map",
    sessionFile: "/tmp/s.jsonl",
  });
  assert.ok(scoutArgs.includes("--tools"));
  assert.equal(scoutArgs[scoutArgs.indexOf("--model") + 1], "cursor-grok-4.6-medium");
});

test("tmux command uses the pi binary path so the shell function is not used", () => {
  const args = tmuxNewSessionArgs({
    session: "paperclip-abc",
    cwd: "/work",
    piBinary: "/opt/homebrew/bin/pi",
    args: ["--mode", "json"],
    env: { PI_CODING_AGENT_DIR: "/Users/me/.pi/agent" },
  });
  assert.equal(args[0], "new-session");
  assert.equal(args.includes("-d"), true);
  assert.match(args.at(-1) ?? "", /exec '\/opt\/homebrew\/bin\/pi'/);
  assert.equal(parkedPaneTarget("paperclip-abc", ["%1", "%2"]), "%2");
  assert.equal(resolvePiBinary("/usr/bin:/opt/homebrew/bin").endsWith("pi") || resolvePiBinary("/usr/bin:/opt/homebrew/bin") === "pi", true);
});

test("persona model writes reject models outside the scoped list", () => {
  mkdirSync(join(dir, "agents"), { recursive: true });
  writeFileSync(join(dir, "settings.json"), `${JSON.stringify({ enabledModels: ["cursor/a"] }, null, 2)}\n`);
  writeFileSync(join(dir, "agents", "scout.md"), "---\nname: scout\nmodel: cursor/a\n---\n");
  assert.throws(() => writePersonaModel(dir, "scout", "openai/not-scoped", ["cursor/a"]), /outside the scoped model list/);
  writePersonaModel(dir, "scout", "cursor/a", ["cursor/a"]);
  assert.throws(() => assertInScope("anthropic/claude-sonnet-5", ["cursor/a"]), /outside/);
  const saved = writeEnabledModels(dir, ["cursor/a", "anthropic/claude-sonnet-5", "cursor/a"]);
  assert.deepEqual(saved, ["cursor/a", "anthropic/claude-sonnet-5"]);
  const fallbacks = writeProviderFallback(dir, "anthropic", ["cursor/a", "anthropic/claude-sonnet-5"], saved);
  assert.equal(fallbacks.fallbacks?.anthropic?.[0]?.id, "a");
  assert.equal(replaceModelLine("---\nmodel: old\n---\n", "cursor/a")?.includes("model: cursor/a"), true);
  const withThinking = replaceThinkingLine("---\nmodel: cursor/a\n---\n", "high");
  assert.match(withThinking ?? "", /thinking: high/);
  writePersonaThinking(dir, "scout", "xhigh");
  assert.match(readText(join(dir, "agents", "scout.md"), "utf8"), /thinking: xhigh/);
  assert.throws(() => writePersonaThinking(dir, "scout", "auto"), /thinking level/);
});

test("task workspace and instructions reach the run, and a harness cwd is the fallback", () => {
  const root = mkdtempSync(join(tmpdir(), "upi-instructions-"));
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "AGENTS.md"), "Follow the bundle.\n");
  assert.equal(runWorkingDirectory({ cwd: "/fallback" }, { paperclipWorkspace: { cwd: "/project" } }), "/project");
  assert.equal(runWorkingDirectory({ cwd: "/fallback" }, {}), "/fallback");
  assert.equal(readPaperclipInstructions({ instructionsRootPath: root, instructionsEntryFile: "AGENTS.md" }), "Follow the bundle.");
  rmSync(root, { recursive: true, force: true });
});

test("an installed extra persona is listed beside the shipped roles", () => {
  const root = mkdtempSync(join(tmpdir(), "upi-personas-"));
  mkdirSync(join(root, "agents"), { recursive: true });
  writeFileSync(join(root, "agents", "local-extra.md"), "---\nname: local-extra\ndescription: local only\nmodel: openai-codex/gpt-6-astra\ntools: read, bash\n---\nLocal work.\n");
  const templates = mkdtempSync(join(tmpdir(), "upi-templates-"));
  writeFileSync(join(templates, "scout.md"), "---\nname: scout\ndescription: look\nmodel: cursor/m\ntools: read\n---\nLook.\n");
  const personas = listPersonas(root, templates);
  assert.ok(personas.some((persona) => persona.name === "orchestrator"));
  assert.ok(personas.some((persona) => persona.name === "local-extra" && persona.source === "installed"));
  assert.ok(personas.some((persona) => persona.name === "scout" && persona.source === "template"));
  rmSync(root, { recursive: true, force: true });
  rmSync(templates, { recursive: true, force: true });
});

test("an extension factory crash is a failed run, not an empty success", () => {
  const text = "\u001b[31mError: Failed to load extension \"/Users/me/.pi/agent/extensions/question-helpers.ts\": Extension does not export a valid factory function: /Users/me/.pi/agent/extensions/question-helpers.ts\u001b[39m\r\n";
  const message = extensionStartupError(text);
  assert.match(message ?? "", /question-helpers\.ts/);
  const parsed = parsePiJsonl(text);
  assert.equal(parsed.errors.length, 0);
});

test("jsonl parser reads usage and assistant errors", () => {
  const parsed = parsePiJsonl([
    JSON.stringify({ type: "turn_end", message: { role: "assistant", content: [{ type: "text", text: "done" }], usage: { input: 3, output: 4, cost: { total: 0.2 } } } }),
    JSON.stringify({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "quota", content: "" } }),
  ].join("\n"));
  assert.equal(parsed.finalMessage, "done");
  assert.equal(deliverableSummary(["The research write-up.", "Research complete — summary posted above."]), "The research write-up.");
  assert.equal(parsed.usage.inputTokens, 3);
  assert.equal(parsed.usage.costUsd, 0.2);
  assert.deepEqual(parsed.errors, ["quota"]);
});

test("a heartbeat refuses an out-of-scope persona model and starts tmux for an in-scope run", async () => {
  const root = mkdtempSync(join(tmpdir(), "upi-heartbeat-"));
  mkdirSync(join(root, "agents"), { recursive: true });
  writeFileSync(join(root, "settings.json"), `${JSON.stringify({ enabledModels: ["cursor/cursor-grok-4.6-medium"] }, null, 2)}\n`);
  writeFileSync(join(root, "auth.json"), "{}\n");
  writeFileSync(join(root, "AGENTS.md"), "# routes\n");
  writeFileSync(join(root, "agents", "scout.md"), "---\nname: scout\nmodel: openai/not-scoped\ntools: read\n---\n");
  const refused = await execute({
    runId: "refuse",
    agent: { id: "scout-agent", companyId: "co", name: "Scout" },
    runtime: {},
    config: { persona: "scout", agentDir: root, cwd: root },
    context: { prompt: "map" },
    onLog: async () => {},
  });
  assert.match(refused.errorMessage ?? "", /outside the scoped model list/);

  const bin = join(root, "bin");
  mkdirSync(bin);
  const marker = join(root, "tmux-marker");
  const pane = join(root, "pane-marker");
  writeFileSync(join(bin, "pi"), `#!/bin/sh
printf '%s\\n' "$TMUX" > ${JSON.stringify(marker)}
tmux split-window -d -t "$TMUX_PANE" "printf scout > ${JSON.stringify(pane)}"
printf '%s\\n' '{"type":"turn_end","message":{"role":"assistant","content":[{"type":"text","text":"ok"}],"usage":{"input":1,"output":1,"cost":{"total":0}}}}'
`);
  chmodSync(join(bin, "pi"), 0o755);
  writeFileSync(join(root, "agents", "scout.md"), "---\nname: scout\nmodel: cursor/cursor-grok-4.6-medium\ntools: read\n---\nLook.\n");
  const previous = process.env.PATH;
  process.env.PATH = `${bin}${previous ? `:${previous}` : ""}`;
  try {
    const ran = await execute({
      runId: "run-1",
      agent: { id: "scout-agent", companyId: "co", name: "Scout" },
      runtime: {},
      config: { persona: "scout", agentDir: root, cwd: root, timeoutSec: 20 },
      context: { prompt: "map the bug" },
      onLog: async () => {},
    });
    assert.equal(ran.timedOut, false);
    assert.equal(ran.exitCode, 0);
    const { readFileSync } = await import("node:fs");
    assert.ok(readFileSync(marker, "utf8").includes(","), "pi saw TMUX");
    assert.equal(readFileSync(pane, "utf8").trim(), "scout");
  } finally {
    process.env.PATH = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("skill switches write ignore lines and leave the skill files", () => {
  const home = mkdtempSync(join(tmpdir(), "upi-skill-switch-"));
  mkdirSync(join(home, "skills", "pdf-reader"), { recursive: true });
  mkdirSync(join(home, "skills", "web-debug"), { recursive: true });
  writeFileSync(join(home, "skills", "pdf-reader", "SKILL.md"), "---\nname: pdf-reader\ndescription: Read PDFs\n---\n");
  writeFileSync(join(home, "skills", "web-debug", "SKILL.md"), "---\nname: web-debug\ndescription: Debug pages\n---\n");
  const before = skillSnapshot(home);
  assert.equal(before.supported, true);
  assert.ok(before.desiredSkills.includes("plugin/visioncraft3r-ultimate-pi/pdf-reader"));
  const bundled = join(home, "bundled", "agentmail");
  mkdirSync(bundled, { recursive: true });
  writeFileSync(join(bundled, "SKILL.md"), "---\nname: agentmail\n---\n");
  symlinkSync(bundled, join(home, "skills", "agentmail"));
  const after = syncSkillSelection(home, ["plugin/visioncraft3r-ultimate-pi/web-debug"], {
    paperclipRuntimeSkills: [{ key: "paperclipai/paperclip/agentmail", runtimeName: "agentmail", source: bundled }],
  });
  assert.equal(after.desiredSkills.includes("plugin/visioncraft3r-ultimate-pi/pdf-reader"), false);
  assert.equal(readText(join(home, "skills", ".ignore"), "utf8").includes("pdf-reader/"), true);
  assert.equal(readText(join(home, "skills", "pdf-reader", "SKILL.md"), "utf8").includes("pdf-reader"), true);
  assert.equal(existsSync(join(home, "skills", "agentmail")), false);
  rmSync(home, { recursive: true, force: true });
});

test("a catalog symlink is removed when its skill name is already installed", () => {
  const home = mkdtempSync(join(tmpdir(), "upi-skill-collision-"));
  mkdirSync(join(home, "skills", "pdf-reader"), { recursive: true });
  writeFileSync(join(home, "skills", "pdf-reader", "SKILL.md"), "---\nname: pdf-reader\ndescription: Read PDFs\n---\n");
  const catalog = join(home, "catalog", "pdf-reader--2717147491");
  mkdirSync(catalog, { recursive: true });
  writeFileSync(join(catalog, "SKILL.md"), "---\nname: pdf-reader\ndescription: Catalog copy\n---\n");
  const link = join(home, "skills", "pdf-reader--2717147491");
  symlinkSync(catalog, link);
  syncSkillSelection(home, ["plugin/visioncraft3r-ultimate-pi/pdf-reader"], {
    paperclipRuntimeSkills: [{
      key: "paperclipai/paperclip/pdf-reader",
      runtimeName: "pdf-reader--2717147491",
      source: catalog,
    }],
  });
  assert.equal(existsSync(link), false);
  assert.equal(readText(join(home, "skills", "pdf-reader", "SKILL.md"), "utf8").includes("Read PDFs"), true);
  rmSync(home, { recursive: true, force: true });
});

test("orchestrator instructions delegate with subagent and a role keeps its job", () => {
  const orchestrator = assignmentInstructions({ persona: "orchestrator", model: "", thinking: "" });
  assert.match(orchestrator, /delegate with subagent/);
  assert.equal(orchestrator.includes("assign that same task"), false);
  const worker = assignmentInstructions({ persona: "worker", model: "cursor/cursor-grok-4.6-xhigh", thinking: "medium" });
  assert.match(worker, /report to Ultimate PI/);
  assert.match(worker, /cursor\/cursor-grok-4\.6-xhigh/);
});

test("org sync seeds once and a later user edit survives until reset", () => {
  const next = { role: "engineer", reportsTo: "orch", capabilities: "edits", instructions: "do the work" };
  const first = planOrgSync({
    role: "general",
    reportsTo: null,
    capabilities: "",
    instructions: "",
    seeded: null,
    next,
  });
  assert.equal(first.writeAgent, true);
  assert.equal(first.writeInstructions, true);
  assert.equal(first.role, "engineer");
  const edited = planOrgSync({
    role: "designer",
    reportsTo: "someone-else",
    capabilities: "custom",
    instructions: "user wrote this",
    seeded: first.seeded,
    next,
  });
  assert.equal(edited.role, "designer");
  assert.equal(edited.reportsTo, "someone-else");
  assert.equal(edited.capabilities, "custom");
  assert.equal(edited.writeInstructions, false);
  const reset = planOrgSync({
    role: "designer",
    reportsTo: "someone-else",
    capabilities: "custom",
    instructions: "user wrote this",
    seeded: first.seeded,
    force: true,
    next,
  });
  assert.equal(reset.role, "engineer");
  assert.equal(reset.reportsTo, "orch");
  assert.equal(reset.writeInstructions, true);
});

test("a mirror marker skips the pi launch", () => {
  assert.equal(mirroredSkipResult("plain task"), null);
  const skipped = mirroredSkipResult("map the files\n\n<!-- ultimate-pi-mirror:scout -->\n");
  assert.equal(skipped?.exitCode, 0);
  assert.equal(skipped?.resultJson, undefined);
  assert.equal(skipped?.summary, undefined);
});

test("a mirror skip clears an in-progress assignee", async () => {
  let status = "in_progress";
  let assignee: string | null = "planner";
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "PATCH") {
      const body = JSON.parse(String(init?.body)) as { status?: string; assigneeAgentId?: string | null };
      status = body.status ?? status;
      assignee = body.assigneeAgentId ?? null;
      return Response.json({ status, assigneeAgentId: assignee });
    }
    return Response.json({ status, assigneeAgentId: assignee });
  }) as typeof fetch;
  await releaseMirrorIssue({ issueId: "issue-1", fetchImpl });
  assert.equal(status, "todo");
  assert.equal(assignee, null);
});

test("a finished run uses the Paperclip task and records a disposition", async () => {
  const prompt = runPrompt({
    paperclipTaskMarkdown: "Title: Use the selected model\n\nReply with one sentence.",
  });
  assert.match(prompt, /Reply with one sentence/);
  assert.equal(chooseRunDisposition("in_progress", []), "done");
  assert.equal(chooseRunDisposition("in_progress", ["child"]), "blocked");
  assert.equal(chooseRunDisposition("done", []), null);
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path.endsWith("/issues/issue-1")) {
      if ((init?.method ?? "GET") === "GET") return Response.json({ status: "in_progress" });
      return Response.json({ status: "done" });
    }
    if (path.includes("/issues?")) return Response.json([]);
    return Response.json({ ok: true });
  }) as typeof fetch;
  await recordRunDisposition({
    issueId: "issue-1",
    companyId: "company-1",
    summary: "Hello from Sonnet.",
    fetchImpl,
  });
  assert.ok(calls.some((call) => call.startsWith("POST ") && call.includes("/comments")));
  assert.ok(calls.some((call) => call.startsWith("PATCH ")));
});

test("a failed disposition patch is not treated as recorded", async () => {
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "PATCH") return new Response("nope", { status: 500 });
    if (String(url).includes("/issues?")) return Response.json([]);
    return Response.json({ status: "in_progress" });
  }) as typeof fetch;
  await assert.rejects(() => recordRunDisposition({
    issueId: "issue-1",
    companyId: "company-1",
    summary: "Hello from Sonnet.",
    fetchImpl,
  }), /disposition left issue-1|PATCH .* 500/);
});

test("a new project folder is created inside the chosen parent and an existing folder is reused", () => {
  const parent = mkdtempSync(join(tmpdir(), "upi-project-"));
  const created = prepareProjectFolder({ mode: "create", folder: parent, name: "Billing Portal" });
  assert.equal(created.cwd, realpathSync(join(parent, "billing-portal")));
  assert.equal(existsSync(created.cwd), true);
  assert.equal(projectFolderName("Billing Portal"), "billing-portal");
  writeFileSync(join(created.cwd, "README.md"), "keep\n");
  assert.throws(() => prepareProjectFolder({ mode: "create", folder: parent, name: "Billing Portal" }), /already has files/);
  const loaded = prepareProjectFolder({ mode: "load", folder: created.cwd, name: "" });
  assert.equal(loaded.cwd, created.cwd);
  assert.equal(loaded.name, "billing-portal");
  rmSync(parent, { recursive: true, force: true });
});

test("tmux listing keeps paperclip sessions and marks the first pane as the session", () => {
  const sessions = parseSessionList("dev\npaperclip-6b14c799-4762-4141-8a7c-1fb805675d76\n  \npaperclip-worker\n");
  assert.deepEqual(sessions, ["paperclip-6b14c799-4762-4141-8a7c-1fb805675d76", "paperclip-worker"]);
  assert.equal(agentIdFromSession(sessions[0] ?? ""), "6b14c799-4762-4141-8a7c-1fb805675d76");
  const panes = parsePaneList("%1|Ultimate PI|pi\n%2|Planner|node\nbad\n");
  assert.equal(panes.length, 2);
  assert.equal(panes[0]?.primary, true);
  assert.equal(panes[1]?.title, "Planner");
  assert.equal(panes[1]?.primary, false);
});

test("a subagent pane is named from its launch script", () => {
  const script = "#!/bin/bash\n# Subagent launch script for morocco-improvements-planner\n# Generated: 2026-09-25T03:26:50.271Z\n# Surface: %343\npi --session x\n";
  assert.deepEqual(parseSubagentScript(script), { surface: "%343", name: "morocco-improvements-planner" });
  assert.equal(parseSubagentScript("#!/bin/bash\necho hi\n"), null);
  const root = mkdtempSync(join(tmpdir(), "upi-scripts-"));
  mkdirSync(join(root, "run-1", "subagent-scripts"), { recursive: true });
  writeFileSync(join(root, "run-1", "subagent-scripts", "planner-1.sh"), script);
  const names = subagentNamesBySurface(["%343", "%999"], root);
  assert.equal(names.get("%343"), "morocco-improvements-planner");
  assert.equal(names.has("%999"), false);
  rmSync(root, { recursive: true, force: true });
});

test("ui patch text applies once and stays applied", () => {
  const replacement = { from: 're("claude_local")', to: 're("ultimate_pi")' };
  const first = patchBundleText('start re("claude_local") end', replacement);
  assert.equal(first.status, "applied");
  assert.equal(first.text.includes("ultimate_pi"), true);
  const second = patchBundleText(first.text, replacement);
  assert.equal(second.status, "already");
  assert.equal(second.text, first.text);
});
