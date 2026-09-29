import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPiArgs,
  deliverKeysArgs,
  parkedPaneTarget,
  pipePaneArgs,
  paperclipChildEnv,
  resolvePiBinary,
  sessionName,
  tmuxNewSessionArgs,
} from "../launch.ts";
import { deliverableSummary, extensionStartupError, parsePiJsonl } from "../parse.ts";
import { listPersonas, ORCHESTRATOR, personaByName, type PersonaFrontmatter } from "../personas.ts";
import { assertInScope, isThinkingLevel, readEnabledModels, writePersonaModel, writePersonaThinking } from "../scope.ts";
import { isMirrorDescription } from "../../../lib/paperclip-mirror.ts";

type RunResult = {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  errorMessage?: string | null;
  usage?: { inputTokens: number; outputTokens: number };
  costUsd?: number | null;
  provider?: string | null;
  model?: string | null;
  sessionParams?: Record<string, unknown> | null;
  clearSession?: boolean;
  summary?: string | null;
  resultJson?: Record<string, unknown>;
};

export type ExecuteContext = {
  runId: string;
  agent: { id: string; companyId: string; name: string; adapterConfig?: unknown };
  runtime: { sessionId?: string | null; sessionParams?: Record<string, unknown> | null };
  config: Record<string, unknown>;
  context: Record<string, unknown>;
  onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
  authToken?: string;
};

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function runWorkingDirectory(config: Record<string, unknown>, context: Record<string, unknown>): string {
  const workspace = context.paperclipWorkspace;
  if (workspace && typeof workspace === "object" && !Array.isArray(workspace)) {
    const cwd = (workspace as Record<string, unknown>).cwd;
    if (typeof cwd === "string" && cwd.trim()) return cwd.trim();
  }
  const configured = asString(config.cwd).trim();
  return configured || process.cwd();
}

export function readPaperclipInstructions(config: Record<string, unknown>): string {
  const root = asString(config.instructionsRootPath).trim();
  const entry = asString(config.instructionsEntryFile).trim() || "AGENTS.md";
  const direct = asString(config.instructionsFilePath).trim();
  const candidates = [
    root ? join(root, entry) : "",
    direct,
  ].filter(Boolean);
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const text = readFileSync(path, "utf8").trim();
      if (text) return text;
    } catch {
      // A missing or unreadable instructions file leaves the persona prompt in place.
    }
  }
  return "";
}

function stringEnv(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const env: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") env[key] = entry;
  }
  return env;
}

function harnessThinking(config: Record<string, unknown>): string {
  for (const key of ["thinking", "effort", "thinkingEffort"]) {
    const value = asString(config[key]).trim().toLowerCase();
    if (!value || value === "auto" || value === "default") continue;
    if (isThinkingLevel(value)) return value;
  }
  return "";
}

function timeoutSeconds(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
}

function ultimatePiRoot(): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  for (const candidate of [join(here, "../../.."), join(here, "../..")]) {
    if (existsSync(join(candidate, "lib/extension-layout.ts"))) return candidate;
  }
  return join(here, "../../..");
}

function templatesDir(): string {
  return fileURLToPath(new URL("../../../templates/agents/", import.meta.url));
}

function agentDirFrom(config: Record<string, unknown>): string {
  return asString(config.agentDir) || process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
}

export function resolvePersona(config: Record<string, unknown>, agentDir: string): PersonaFrontmatter {
  const requested = asString(config.persona, ORCHESTRATOR) || ORCHESTRATOR;
  const personas = listPersonas(agentDir, templatesDir());
  const persona = personaByName(personas, requested);
  if (!persona) throw new Error(`unknown Ultimate PI persona: ${requested}`);
  return persona;
}

function sessionFileFor(agentId: string, resumed: string): string {
  if (resumed) return resumed;
  const dir = join(homedir(), ".pi", "paperclips");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(dir, `${stamp}-${agentId}.jsonl`);
  writeFileSync(path, "", { flag: "wx" });
  return path;
}

function runTmux(args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("tmux", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function waitForExit(session: string, logPath: string, onLog: ExecuteContext["onLog"], timeoutSec: number): Promise<boolean> {
  const started = Date.now();
  let offset = 0;
  const { readFileSync } = await import("node:fs");
  while (true) {
    try {
      const text = readFileSync(logPath, "utf8");
      if (text.length > offset) {
        await onLog("stdout", text.slice(offset));
        offset = text.length;
      }
    } catch {
      // pipe-pane creates the file on first output
    }
    const listed = await runTmux(["has-session", "-t", session], 5000);
    if (listed.code !== 0) return false;
    if (timeoutSec > 0 && Date.now() - started > timeoutSec * 1000) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

export function mirroredSkipResult(description: string): RunResult | null {
  if (!isMirrorDescription(description)) return null;
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorMessage: null,
  };
}

function contextIssueId(context: Record<string, unknown>): string {
  for (const key of ["issueId", "taskId"]) {
    const value = context[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function runPrompt(context: Record<string, unknown>): string {
  const direct = [asString(context.prompt), asString(context.taskTitle), asString(context.comment)]
    .map((value) => value.trim())
    .find(Boolean) ?? "";
  const task = asString(context.paperclipTaskMarkdown).trim();
  const body = [direct, task].filter(Boolean).join("\n\n");
  const approval = asString(context.approvalStatus).trim();
  return (approval ? `${body}\n\nApproval status: ${approval}` : body).trim() || "Continue the assigned work.";
}

const OPEN_CHILD_STATUSES = new Set(["backlog", "todo", "in_progress", "in_review", "blocked"]);

export function chooseRunDisposition(issueStatus: string, openChildIds: readonly string[]): "done" | "blocked" | null {
  if (issueStatus !== "in_progress") return null;
  return openChildIds.length > 0 ? "blocked" : "done";
}

function issueList(body: unknown): Array<{ id?: string; status?: string }> {
  if (Array.isArray(body)) return body as Array<{ id?: string; status?: string }>;
  if (body && typeof body === "object" && Array.isArray((body as { issues?: unknown }).issues)) {
    return (body as { issues: Array<{ id?: string; status?: string }> }).issues;
  }
  return [];
}

function paperclipApiBase(): string {
  const port = process.env.PAPERCLIP_LISTEN_PORT ?? process.env.PORT ?? "3100";
  return `http://127.0.0.1:${port}/api`;
}

async function paperclipRequest(method: string, path: string, authToken: string | undefined, body: unknown, fetchImpl: typeof fetch): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetchImpl(`${paperclipApiBase()}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

async function paperclipMutation(method: string, path: string, authToken: string | undefined, body: unknown, fetchImpl: typeof fetch): Promise<unknown> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  const response = await fetchImpl(`${paperclipApiBase()}${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${method} ${path} ${response.status} ${text}`.trim());
  }
  return response.json().catch(() => null);
}

export async function recordRunDisposition(input: {
  issueId: string;
  companyId: string;
  authToken?: string;
  summary: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  if (!input.issueId || !input.companyId) return;
  const fetchImpl = input.fetchImpl ?? fetch;
  const issue = await paperclipRequest("GET", `/issues/${input.issueId}`, input.authToken, undefined, fetchImpl) as { status?: string } | null;
  if (!issue?.status) return;
  const listed = await paperclipRequest("GET", `/companies/${input.companyId}/issues?parentId=${input.issueId}`, input.authToken, undefined, fetchImpl);
  const openChildIds = issueList(listed)
    .filter((child) => child.id && child.id !== input.issueId && OPEN_CHILD_STATUSES.has(child.status ?? ""))
    .map((child) => child.id as string);
  const status = chooseRunDisposition(issue.status, openChildIds);
  if (!status) return;
  const comment = input.summary.trim() || (status === "blocked" ? "Waiting on delegated sub-tasks." : "Run finished.");
  await paperclipRequest("POST", `/issues/${input.issueId}/comments`, input.authToken, { body: comment }, fetchImpl);
  const updated = await paperclipMutation("PATCH", `/issues/${input.issueId}`, input.authToken, status === "blocked"
    ? { status, blockedByIssueIds: openChildIds }
    : { status }, fetchImpl) as { status?: string } | null;
  if (!updated?.status || updated.status === "in_progress") {
    throw new Error(`disposition left ${input.issueId} in_progress`);
  }
}

export async function releaseMirrorIssue(input: {
  issueId: string;
  authToken?: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  if (!input.issueId) return;
  const fetchImpl = input.fetchImpl ?? fetch;
  const issue = await paperclipRequest("GET", `/issues/${input.issueId}`, input.authToken, undefined, fetchImpl) as { status?: string; assigneeAgentId?: string | null } | null;
  if (!issue?.status || issue.status === "done" || issue.status === "cancelled") return;
  if (issue.status === "todo" && !issue.assigneeAgentId) return;
  const updated = await paperclipMutation("PATCH", `/issues/${input.issueId}`, input.authToken, {
    status: "todo",
    assigneeAgentId: null,
  }, fetchImpl) as { status?: string; assigneeAgentId?: string | null } | null;
  if (!updated || updated.status === "in_progress" || updated.assigneeAgentId) {
    throw new Error(`mirror release failed for ${input.issueId}`);
  }
}

export async function readIssueDescription(issueId: string, authToken?: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (!issueId) return "";
  const port = process.env.PAPERCLIP_LISTEN_PORT ?? process.env.PORT ?? "3100";
  const headers: Record<string, string> = {};
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/api/issues/${issueId}`, { headers });
    if (!response.ok) return "";
    const body = await response.json() as { description?: unknown };
    return typeof body.description === "string" ? body.description : "";
  } catch {
    return "";
  }
}

export async function execute(ctx: ExecuteContext): Promise<RunResult> {
  const issueId = contextIssueId(ctx.context);
  const description = await readIssueDescription(issueId, ctx.authToken);
  const skipped = mirroredSkipResult(description);
  if (skipped) {
    await releaseMirrorIssue({ issueId, authToken: ctx.authToken });
    return skipped;
  }

  const agentDir = agentDirFrom(ctx.config);
  let persona = resolvePersona(ctx.config, agentDir);
  const scoped = readEnabledModels(agentDir);
  try {
    const requested = asString(ctx.config.model).trim();
    if (requested && requested !== "auto" && requested !== "default" && requested !== persona.model) {
      if (persona.name === ORCHESTRATOR) {
        assertInScope(requested, scoped);
        persona = { ...persona, model: requested };
      } else {
        writePersonaModel(agentDir, persona.name, requested, scoped);
        persona = resolvePersona(ctx.config, agentDir);
      }
    }
    assertInScope(persona.model, scoped);
    const thinking = harnessThinking(ctx.config);
    if (thinking && thinking !== persona.thinking) {
      if (persona.name === ORCHESTRATOR) {
        persona = { ...persona, thinking };
      } else {
        writePersonaThinking(agentDir, persona.name, thinking);
        persona = resolvePersona(ctx.config, agentDir);
      }
    }
  } catch (err) {
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  const resumed = asString(ctx.runtime.sessionParams?.sessionId);
  let sessionFile = "";
  try {
    sessionFile = sessionFileFor(ctx.agent.id, resumed);
  } catch {
    sessionFile = resumed;
  }
  const cwd = runWorkingDirectory(ctx.config, ctx.context);
  const userPrompt = runPrompt(ctx.context);
  const instructions = readPaperclipInstructions(ctx.config);
  const personaPrompt = persona.name === ORCHESTRATOR
    ? "You are the Ultimate PI orchestrator. Follow AGENTS.md. Call jev_triage before dispatching. Subagents run in tmux panes."
    : persona.body || persona.description;
  const systemPrompt = instructions ? `${personaPrompt}\n\n${instructions}` : personaPrompt;
  const args = buildPiArgs({
    persona,
    scopedModels: scoped,
    systemPrompt,
    userPrompt,
    sessionFile,
  });
  const session = sessionName(ctx.agent.id);
  const logPath = join(tmpdir(), `${session}-${ctx.runId}.log`);
  writeFileSync(logPath, "");
  const env = paperclipChildEnv({
    agentId: ctx.agent.id,
    companyId: ctx.agent.companyId,
    runId: ctx.runId,
    authToken: ctx.authToken,
    agentDir,
    context: ctx.context,
    extraEnv: stringEnv(ctx.config.env),
  });
  const updater = join(ultimatePiRoot(), "lib/launch-update.ts");
  const update = spawn(process.execPath, ["--experimental-strip-types", updater, "--sync-only"], {
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, ULTIMATE_PI_ROOT: ultimatePiRoot() },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let updateLog = "";
  update.stdout?.setEncoding("utf8");
  update.stderr?.setEncoding("utf8");
  update.stdout?.on("data", (chunk) => {
    updateLog += chunk;
  });
  update.stderr?.on("data", (chunk) => {
    updateLog += chunk;
  });
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      update.kill("SIGTERM");
      resolve();
    }, 180000);
    update.on("close", () => {
      clearTimeout(timer);
      resolve();
    });
    update.on("error", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (updateLog.trim()) await ctx.onLog("stderr", `[ultimate-pi] ${updateLog.trim()}\n`);
  const layout = join(ultimatePiRoot(), "lib/extension-layout.ts");
  const layoutCheck = spawnSync(process.execPath, ["--experimental-strip-types", layout, "--check", agentDir], { encoding: "utf8" });
  if (layoutCheck.status !== 0) {
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: (layoutCheck.stdout || layoutCheck.stderr || "extension layout check failed").trim(),
    };
  }
  const piBinary = resolvePiBinary();
  await ctx.onLog("stderr", `[ultimate-pi] tmux session ${session} persona ${persona.name}\n`);
  const started = await runTmux(
    tmuxNewSessionArgs({ session, cwd, piBinary, args, env }),
    15000,
  );
  if (started.code !== 0) {
    return {
      exitCode: started.code,
      signal: null,
      timedOut: false,
      errorMessage: started.stderr || started.stdout || "tmux new-session failed",
    };
  }
  await runTmux(pipePaneArgs(session, logPath), 5000);
  const comment = asString(ctx.context.wakeComment);
  if (comment) {
    const panes = await runTmux(["list-panes", "-t", session, "-F", "#{pane_id}"], 5000);
    const ids = panes.stdout.split(/\n/).map((line) => line.trim()).filter(Boolean);
    const target = parkedPaneTarget(session, ids);
    for (const keys of deliverKeysArgs(target, comment)) {
      await runTmux(keys, 5000);
    }
  }
  const timeoutSec = timeoutSeconds(ctx.config.runLimitSec ?? ctx.config.timeoutSec);
  const timedOut = await waitForExit(session, logPath, ctx.onLog, timeoutSec);
  if (timedOut) {
    await runTmux(["kill-session", "-t", session], 5000);
  }
  const { readFileSync } = await import("node:fs");
  let stdout = "";
  try {
    stdout = readFileSync(logPath, "utf8");
  } catch {
    stdout = "";
  }
  const parsed = parsePiJsonl(stdout);
  const startup = extensionStartupError(stdout);
  if (startup) parsed.errors.unshift(startup);
  const spec = persona.model.includes("/") ? persona.model.split("/") : [];
  const succeeded = !timedOut && parsed.errors.length === 0;
  const summary = deliverableSummary(parsed.messages);
  if (succeeded) {
    try {
      await recordRunDisposition({
        issueId,
        companyId: ctx.agent.companyId,
        authToken: ctx.authToken,
        summary,
      });
    } catch (err) {
      await ctx.onLog("stderr", `[ultimate-pi] disposition failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
  return {
    exitCode: timedOut ? null : parsed.errors.length > 0 ? 1 : 0,
    signal: null,
    timedOut,
    errorMessage: parsed.errors[0] ?? null,
    usage: { inputTokens: parsed.usage.inputTokens, outputTokens: parsed.usage.outputTokens },
    costUsd: parsed.usage.costUsd,
    provider: spec[0] ?? null,
    model: spec.slice(1).join("/") || null,
    summary: summary || null,
    resultJson: summary ? { summary } : undefined,
    sessionParams: { sessionId: sessionFile, cwd, tmuxSession: session },
  };
}

export async function deliverToParkedPane(agentId: string, text: string): Promise<void> {
  const session = sessionName(agentId);
  const panes = await runTmux(["list-panes", "-t", session, "-F", "#{pane_id}"], 5000);
  if (panes.code !== 0) return;
  const ids = panes.stdout.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const target = parkedPaneTarget(session, ids);
  for (const keys of deliverKeysArgs(target, text)) {
    await runTmux(keys, 5000);
  }
}
