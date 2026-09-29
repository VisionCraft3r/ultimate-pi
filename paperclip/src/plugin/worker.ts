import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { deliverToParkedPane } from "../server/index.ts";
import { listPaperclipSessions, stopAllPaperclipSessions, stopPaperclipPane, stopPaperclipSession, subagentNamesBySurface } from "../launch.ts";
import { assignmentInstructions, hashText, ORG, planOrgSync, type OrgSeedState } from "../org.ts";
import { beginFolderPick, prepareProjectFolder, readFolderPick } from "../project-folder.ts";
import { applyPaperclipUiPatches } from "../../scripts/patch-paperclip-ui.mjs";
import { listPersonas, personaByName } from "../personas.ts";
import { piSkillDeclarations } from "../pi-skills.ts";
import { isThinkingLevel, readEnabledModels, readFallbacks, writeEnabledModels, writePersonaModel, writePersonaThinking, writeProviderFallback } from "../scope.ts";
import { isMirrorDescription, mirrorShownBesidePane } from "../../../lib/paperclip-mirror.ts";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
}

function templatesDir(): string {
  return fileURLToPath(new URL("../../../templates/agents/", import.meta.url));
}

function catalog(): string[] {
  const listed = spawnSync("pi", ["--list-models"], { encoding: "utf8", timeout: 20000 });
  const text = `${listed.stdout ?? ""}\n${listed.stderr ?? ""}`;
  const models: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s{2,}/);
    if (parts.length < 2) continue;
    const provider = parts[0]?.trim() ?? "";
    const model = parts[1]?.trim() ?? "";
    if (!provider || !model || provider === "provider") continue;
    models.push(`${provider}/${model}`);
  }
  return models;
}

function payloadText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  for (const key of ["body", "text", "comment", "decisionNote", "message"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function payloadAgentId(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  for (const key of ["agentId", "assigneeAgentId", "authorAgentId"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

type LiveAgent = {
  id: string;
  status: string;
  role: string;
  reportsTo: string | null;
  capabilities: string | null;
  adapterConfig?: Record<string, unknown>;
};

async function paperclip(method: string, path: string, body?: unknown): Promise<unknown> {
  const port = process.env.PAPERCLIP_LISTEN_PORT ?? process.env.PORT ?? "3100";
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${path} ${response.status} ${await response.text()}`);
  return response.json();
}

type RunningAgent = { id?: string; name?: string };
type RunningIssue = { id?: string; identifier?: string; title?: string; description?: string | null; status?: string };

const RUNNING_INFO_TTL_MS = 10_000;
const runningInfoCache = new Map<string, { at: number; agents: RunningAgent[]; mirrors: RunningIssue[] }>();

async function runningCompanyInfo(companyId: string): Promise<{ agents: RunningAgent[]; mirrors: RunningIssue[] }> {
  const cached = runningInfoCache.get(companyId);
  if (cached && Date.now() - cached.at < RUNNING_INFO_TTL_MS) return cached;
  let agents: RunningAgent[] = [];
  let mirrors: RunningIssue[] = [];
  try {
    const listed = await paperclip("GET", `/companies/${companyId}/agents`) as RunningAgent[] | { agents?: RunningAgent[] };
    agents = Array.isArray(listed) ? listed : listed.agents ?? [];
  } catch {
    agents = [];
  }
  try {
    const listed = await paperclip("GET", `/companies/${companyId}/issues?status=in_progress,todo,blocked,in_review`) as RunningIssue[] | { issues?: RunningIssue[] };
    const issues = Array.isArray(listed) ? listed : listed.issues ?? [];
    mirrors = issues.filter((issue) => isMirrorDescription(issue.description ?? "") && issue.status !== "done" && issue.status !== "cancelled");
  } catch {
    mirrors = [];
  }
  const entry = { at: Date.now(), agents, mirrors };
  runningInfoCache.set(companyId, entry);
  return entry;
}

type SyncContext = {
  agents: { managed: { reconcile: (key: string, companyId: string) => Promise<{ agent?: LiveAgent | null }> } };
  state: { get: (input: { scopeKind: "company"; scopeId: string; namespace: string; stateKey: string }) => Promise<unknown>; set: (input: { scopeKind: "company"; scopeId: string; namespace: string; stateKey: string }, value: unknown) => Promise<void> };
};

function seedKey(companyId: string) {
  return { scopeKind: "company" as const, scopeId: companyId, namespace: "ultimate-pi", stateKey: "org-seed" };
}

function readSeed(value: unknown): OrgSeedState {
  if (!value || typeof value !== "object" || !("seats" in value)) return { seats: {} };
  const seats = (value as OrgSeedState).seats;
  return { seats: seats && typeof seats === "object" ? seats : {} };
}

function seedFilePath(): string {
  return join(agentDir(), "paperclip-org-seed.json");
}

function readSeedFile(companyId: string): OrgSeedState {
  try {
    const parsed = JSON.parse(readFileSync(seedFilePath(), "utf8")) as Record<string, unknown>;
    return readSeed(parsed[companyId]);
  } catch {
    return { seats: {} };
  }
}

function writeSeedFile(companyId: string, state: OrgSeedState): void {
  const path = seedFilePath();
  let all: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    if (parsed && typeof parsed === "object") all = parsed;
  } catch {
    all = {};
  }
  all[companyId] = state;
  mkdirSync(agentDir(), { recursive: true });
  writeFileSync(path, `${JSON.stringify(all, null, 2)}\n`);
}

async function syncCompany(companyId: string, ctx: SyncContext, options?: { force?: boolean }): Promise<void> {
  const personas = listPersonas(agentDir(), templatesDir());
  const seats = new Map<string, LiveAgent>();
  for (const seat of ORG) {
    const resolved = await ctx.agents.managed.reconcile(seat.persona, companyId);
    const agent = resolved.agent;
    if (!agent || agent.status === "terminated") continue;
    seats.set(seat.persona, agent);
  }
  let stored = readSeedFile(companyId);
  try {
    const remote = readSeed(await ctx.state.get(seedKey(companyId)));
    if (Object.keys(remote.seats).length > 0) stored = remote;
  } catch {
    // The host has no plugin.state capability until the manifest is reloaded. The agent-dir file is the seed record until then.
  }
  const orchestratorId = seats.get("orchestrator")?.id ?? null;
  const nextSeats = { ...stored.seats };
  for (const seat of ORG) {
    const agent = seats.get(seat.persona);
    if (!agent) continue;
    const persona = personaByName(personas, seat.persona);
    const reportsTo = seat.manager ? orchestratorId : null;
    const config = { ...(agent.adapterConfig ?? {}) };
    if (seat.persona !== "orchestrator" && persona?.model) {
      config.model = persona.model;
      if (persona.thinking && isThinkingLevel(persona.thinking)) config.thinking = persona.thinking;
      else {
        delete config.thinking;
        delete config.effort;
        delete config.thinkingEffort;
      }
    }
    const instructions = assignmentInstructions({
      persona: seat.persona,
      model: persona?.model ?? "",
      thinking: persona?.thinking && isThinkingLevel(persona.thinking) ? persona.thinking : "",
    });
    const instructionPath = typeof config.instructionsFilePath === "string" ? config.instructionsFilePath : "";
    let current = "";
    if (instructionPath) {
      try {
        current = readFileSync(instructionPath, "utf8").trim();
      } catch {
        current = "";
      }
    }
    const plan = planOrgSync({
      role: agent.role,
      reportsTo: agent.reportsTo,
      capabilities: agent.capabilities,
      instructions: current,
      seeded: stored.seats[seat.persona] ?? null,
      force: options?.force,
      next: { role: seat.role, reportsTo, capabilities: seat.capability, instructions },
    });
    const sameConfig = JSON.stringify(config) === JSON.stringify(agent.adapterConfig ?? {});
    if (plan.writeAgent || !sameConfig) {
      await paperclip("PATCH", `/agents/${agent.id}`, {
        role: plan.role,
        reportsTo: plan.reportsTo,
        capabilities: plan.capabilities,
        adapterConfig: config,
        replaceAdapterConfig: true,
      });
    }
    if (plan.writeInstructions && hashText(current) !== hashText(instructions)) {
      await paperclip("PUT", `/agents/${agent.id}/instructions-bundle/file`, {
        path: "AGENTS.md",
        content: `${instructions}\n`,
      });
    }
    nextSeats[seat.persona] = plan.seeded;
  }
  const nextState = { seats: nextSeats };
  writeSeedFile(companyId, nextState);
  try {
    await ctx.state.set(seedKey(companyId), nextState);
  } catch {
    // Local file already holds the seed.
  }
}

const plugin = definePlugin({
  async setup(ctx) {
    try {
      const patched = applyPaperclipUiPatches();
      for (const warning of patched.warnings) ctx.logger.warn(warning);
    } catch (err) {
      ctx.logger.warn("Ultimate PI UI patch failed", { error: err instanceof Error ? err.message : String(err) });
    }
    try {
      const companies = await ctx.companies.list();
      for (const company of companies) {
        for (const skill of piSkillDeclarations()) {
          await ctx.skills.managed.reconcile(skill.skillKey, company.id);
        }
        await syncCompany(company.id, ctx);
      }
    } catch (err) {
      ctx.logger.warn("Ultimate PI skill publish failed", { error: err instanceof Error ? err.message : String(err) });
    }

    ctx.data.register("questions", async () => {
      try {
        return JSON.parse(readFileSync(join(agentDir(), "paperclip-questions.json"), "utf8"));
      } catch {
        return [];
      }
    });

    ctx.data.register("running", async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const sessions = listPaperclipSessions();
      if (sessions.length === 0) return { sessions: [], mirrors: [] };
      const { agents, mirrors } = companyId ? await runningCompanyInfo(companyId) : { agents: [], mirrors: [] };
      const names = subagentNamesBySurface(sessions.flatMap((session) => session.panes.map((pane) => pane.paneId)));
      const sessionRows = sessions.map((session) => ({
        ...session,
        agentName: agents.find((agent) => agent.id === session.agentId)?.name ?? "Ultimate PI",
        panes: session.panes.map((pane) => ({
          ...pane,
          label: pane.primary ? "Session" : (names.get(pane.paneId) || pane.title.trim() || pane.command.trim() || "Subagent"),
        })),
      }));
      const paneLabels = sessionRows.flatMap((session) => session.panes.filter((pane) => !pane.primary).map((pane) => pane.label));
      return {
        sessions: sessionRows,
        mirrors: mirrors.filter((issue) => !mirrorShownBesidePane(issue.title ?? "", paneLabels)).map((issue) => ({
          id: issue.id ?? "",
          identifier: issue.identifier ?? "",
          title: issue.title ?? "",
          status: issue.status ?? "",
        })),
      };
    });

    ctx.data.register("setup", async () => {
      const dir = agentDir();
      const scopedModels = readEnabledModels(dir);
      return {
        agentDir: dir,
        scopedModels,
        catalog: catalog(),
        personas: listPersonas(dir, templatesDir()),
        fallbacks: readFallbacks(dir),
      };
    });

    ctx.actions.register("saveScope", async (params) => {
      const models = Array.isArray(params.models) ? params.models.filter((entry): entry is string => typeof entry === "string") : [];
      return { scopedModels: writeEnabledModels(agentDir(), models) };
    });

    ctx.actions.register("savePersonaModel", async (params) => {
      const persona = typeof params.persona === "string" ? params.persona : "";
      const model = typeof params.model === "string" ? params.model : "";
      const dir = agentDir();
      writePersonaModel(dir, persona, model, readEnabledModels(dir));
      return { persona, model };
    });

    ctx.actions.register("savePersonaThinking", async (params) => {
      const persona = typeof params.persona === "string" ? params.persona : "";
      const thinking = typeof params.thinking === "string" ? params.thinking.trim().toLowerCase() : "";
      if (!isThinkingLevel(thinking)) throw new Error("Choose off, minimal, low, medium, high, or xhigh.");
      writePersonaThinking(agentDir(), persona, thinking);
      return { persona, thinking };
    });

    ctx.actions.register("saveFallback", async (params) => {
      const provider = typeof params.provider === "string" ? params.provider : "";
      const chain = Array.isArray(params.chain) ? params.chain.filter((entry): entry is string => typeof entry === "string") : [];
      const dir = agentDir();
      return writeProviderFallback(dir, provider, chain, readEnabledModels(dir));
    });

    ctx.actions.register("resetOrg", async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      if (!companyId) throw new Error("companyId is required");
      await syncCompany(companyId, ctx, { force: true });
      return { ok: true };
    });

    ctx.actions.register("stopAgent", async (params) => {
      const session = typeof params.session === "string" ? params.session : "";
      stopPaperclipSession(session);
      return { stopped: session };
    });

    ctx.actions.register("stopPane", async (params) => {
      const session = typeof params.session === "string" ? params.session : "";
      const paneId = typeof params.paneId === "string" ? params.paneId : "";
      stopPaperclipPane(session, paneId);
      return { stopped: paneId };
    });

    ctx.actions.register("stopAll", async () => ({ stopped: stopAllPaperclipSessions() }));

    ctx.actions.register("chooseProjectFolder", async (params) => {
      const prompt = typeof params.prompt === "string" ? params.prompt : "Select a folder";
      return beginFolderPick(prompt);
    });

    ctx.actions.register("readProjectFolder", async () => readFolderPick());

    ctx.actions.register("prepareProjectFolder", async (params) => {
      const mode = typeof params.mode === "string" ? params.mode : "create";
      const folder = typeof params.folder === "string" ? params.folder : "";
      const name = typeof params.name === "string" ? params.name : "";
      return prepareProjectFolder({ mode, folder, name });
    });

    ctx.actions.register("hire", async (params) => {
      const agentKey = typeof params.agentKey === "string" ? params.agentKey : "";
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      if (!agentKey || !companyId) throw new Error("agentKey and companyId are required");
      return ctx.agents.managed.reconcile(agentKey, companyId);
    });

    ctx.events.on("issue.created", async (event) => {
      const issueId = typeof event.entityId === "string" ? event.entityId : "";
      const companyId = typeof event.companyId === "string" ? event.companyId : "";
      if (!issueId || !companyId) return;
      const issue = await paperclip("GET", `/issues/${issueId}`) as {
        assigneeAgentId?: string | null;
        status?: string;
        description?: string | null;
      };
      if (isMirrorDescription(issue.description ?? "")) {
        if (issue.assigneeAgentId || issue.status === "in_progress") {
          await paperclip("PATCH", `/issues/${issueId}`, { status: "todo", assigneeAgentId: null });
        }
        return;
      }
      if (issue.assigneeAgentId) return;
      if (!issue.status || issue.status === "backlog" || issue.status === "done" || issue.status === "cancelled") return;
      const listed = await paperclip("GET", `/companies/${companyId}/agents`) as Array<{ id?: string; status?: string; adapterConfig?: { persona?: string } }> | { agents?: Array<{ id?: string; status?: string; adapterConfig?: { persona?: string } }> };
      const agents = Array.isArray(listed) ? listed : listed.agents ?? [];
      const orchestrator = agents.find((agent) => agent.status !== "terminated" && agent.adapterConfig?.persona === "orchestrator" && agent.id);
      if (!orchestrator?.id) return;
      await paperclip("PATCH", `/issues/${issueId}`, { assigneeAgentId: orchestrator.id });
    });

    const deliver = async (payload: unknown) => {
      const text = payloadText(payload);
      const agentId = payloadAgentId(payload);
      if (!text || !agentId) return;
      await deliverToParkedPane(agentId, text);
    };
    ctx.events.on("issue.comment.created", async (event) => {
      await deliver(event.payload);
    });
    ctx.events.on("approval.decided", async (event) => {
      await deliver(event.payload);
    });
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
