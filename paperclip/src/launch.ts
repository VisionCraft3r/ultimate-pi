import { spawnSync } from "node:child_process";
import { delimiter } from "node:path";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PersonaFrontmatter } from "./personas.ts";
import { splitModelRef } from "./scope.ts";

export function paperclipChildEnv(input: {
  agentId: string;
  companyId: string;
  runId: string;
  authToken?: string;
  agentDir: string;
  context: Record<string, unknown>;
  extraEnv?: Record<string, string>;
}): Record<string, string> {
  const taskId = [input.context.taskId, input.context.issueId].find((value) => typeof value === "string" && value.trim());
  const listenHost = process.env.PAPERCLIP_LISTEN_HOST ?? process.env.HOST ?? "127.0.0.1";
  const host = listenHost === "0.0.0.0" || listenHost === "::" ? "127.0.0.1" : listenHost;
  const port = process.env.PAPERCLIP_LISTEN_PORT ?? process.env.PORT ?? "3100";
  const apiUrl = process.env.PAPERCLIP_API_URL ?? `http://${host}:${port}`;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.extraEnv ?? {})) {
    if (!key || key === "PAPERCLIP_PI_PROVIDERS") continue;
    env[key] = value;
  }
  Object.assign(env, {
    PI_CODING_AGENT_DIR: input.agentDir,
    PAPERCLIP_AGENT_ID: input.agentId,
    PAPERCLIP_COMPANY_ID: input.companyId,
    PAPERCLIP_RUN_ID: input.runId,
    PAPERCLIP_API_URL: apiUrl,
  });
  if (input.authToken) env.PAPERCLIP_API_KEY = input.authToken;
  if (typeof taskId === "string") env.PAPERCLIP_TASK_ID = taskId.trim();
  return env;
}

export function sessionName(agentId: string): string {
  const safe = agentId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48);
  return `paperclip-${safe || "agent"}`;
}

export function resolvePiBinary(pathEnv = process.env.PATH ?? ""): string {
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, "pi");
    if (existsSync(candidate)) return candidate;
  }
  return "pi";
}

export function buildPiArgs(input: {
  persona: PersonaFrontmatter;
  scopedModels: readonly string[];
  systemPrompt: string;
  userPrompt: string;
  sessionFile: string;
}): string[] {
  const args = ["--mode", "json", "--print", "--append-system-prompt", input.systemPrompt];
  if (input.scopedModels.length > 0) {
    args.push("--models", input.scopedModels.join(","));
  }
  const spec = input.persona.model ? splitModelRef(input.persona.model) : undefined;
  if (spec) {
    args.push("--provider", spec.provider, "--model", spec.id);
  }
  if (input.persona.thinking && !input.persona.thinking.includes("{{")) {
    args.push("--thinking", input.persona.thinking);
  }
  if (input.persona.name !== "orchestrator" && input.persona.tools) {
    args.push("--tools", input.persona.tools);
  }
  args.push("--session", input.sessionFile, input.userPrompt);
  return args;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Detached tmux session whose main process is the real pi binary, so TMUX is set. */
export function tmuxNewSessionArgs(input: {
  session: string;
  cwd: string;
  piBinary: string;
  args: readonly string[];
  env: Record<string, string>;
}): string[] {
  const exports = Object.entries(input.env)
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join("; ");
  const pi = [shellQuote(input.piBinary), ...input.args.map(shellQuote)].join(" ");
  const inner = `${exports}; cd ${shellQuote(input.cwd)}; exec ${pi}`;
  return ["new-session", "-d", "-s", input.session, "-c", input.cwd, inner];
}

export function pipePaneArgs(session: string, logPath: string): string[] {
  return ["pipe-pane", "-t", session, "-o", `cat >> ${shellQuote(logPath)}`];
}

export function deliverKeysArgs(target: string, text: string): string[][] {
  const payload = text.endsWith("\n") ? text.slice(0, -1) : text;
  return [
    ["send-keys", "-t", target, "-l", payload],
    ["send-keys", "-t", target, "Enter"],
  ];
}

export function parkedPaneTarget(session: string, paneIds: readonly string[]): string {
  if (paneIds.length === 0) return session;
  return paneIds[paneIds.length - 1] ?? session;
}

export type RunningPane = {
  paneId: string;
  title: string;
  command: string;
  primary: boolean;
};

export type RunningSession = {
  session: string;
  agentId: string;
  panes: RunningPane[];
};

export function agentIdFromSession(session: string): string {
  return session.startsWith("paperclip-") ? session.slice("paperclip-".length) : "";
}

export function parseSessionList(stdout: string): string[] {
  return stdout.split(/\n/).map((line) => line.trim()).filter((line) => line.startsWith("paperclip-"));
}

export function parsePaneList(stdout: string): RunningPane[] {
  return stdout.split(/\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    const [paneId = "", title = "", command = ""] = line.split("|");
    return { paneId, title, command, primary: index === 0 };
  }).filter((pane) => pane.paneId.startsWith("%"));
}

function tmuxText(args: string[]): string {
  const result = spawnSync("tmux", args, { encoding: "utf8" });
  if (result.status !== 0) return "";
  return result.stdout ?? "";
}

export function listPaperclipSessions(): RunningSession[] {
  return parseSessionList(tmuxText(["list-sessions", "-F", "#{session_name}"])).map((session) => ({
    session,
    agentId: agentIdFromSession(session),
    panes: parsePaneList(tmuxText(["list-panes", "-t", session, "-F", "#{pane_id}|#{pane_title}|#{pane_current_command}"])),
  }));
}

export function parseSubagentScript(text: string): { surface: string; name: string } | null {
  const surface = text.match(/^# Surface: (%\d+)$/m)?.[1];
  const name = text.match(/^# Subagent launch script for (.+)$/m)?.[1]?.trim();
  return surface && name ? { surface, name } : null;
}

/** Map live pane ids to the subagent names recorded in their launch scripts. */
export function subagentNamesBySurface(paneIds: readonly string[], root = join(homedir(), ".pi", "paperclips", "artifacts")): Map<string, string> {
  const wanted = new Set(paneIds);
  const names = new Map<string, { name: string; at: number }>();
  if (wanted.size === 0 || !existsSync(root)) return new Map();
  for (const artifact of readdirSync(root)) {
    const dir = join(root, artifact, "subagent-scripts");
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".sh")) continue;
      const path = join(dir, file);
      let parsed: { surface: string; name: string } | null = null;
      let at = 0;
      try {
        at = statSync(path).mtimeMs;
        parsed = parseSubagentScript(readFileSync(path, "utf8").slice(0, 600));
      } catch {
        continue;
      }
      if (!parsed || !wanted.has(parsed.surface)) continue;
      const seen = names.get(parsed.surface);
      if (!seen || seen.at < at) names.set(parsed.surface, { name: parsed.name, at });
    }
  }
  return new Map([...names].map(([surface, entry]) => [surface, entry.name]));
}

export function assertPaperclipSession(session: string): void {
  if (!session.startsWith("paperclip-") || session.includes(" ") || session.includes("\n")) {
    throw new Error("Refusing to stop a session outside Ultimate PI.");
  }
}

export function stopPaperclipSession(session: string): void {
  assertPaperclipSession(session);
  spawnSync("tmux", ["kill-session", "-t", session], { encoding: "utf8" });
}

export function stopPaperclipPane(session: string, paneId: string): void {
  assertPaperclipSession(session);
  if (!/^%\d+$/.test(paneId)) throw new Error("Refusing to stop an unknown pane.");
  spawnSync("tmux", ["kill-pane", "-t", paneId], { encoding: "utf8" });
}

export function stopAllPaperclipSessions(): string[] {
  const sessions = listPaperclipSessions().map((entry) => entry.session);
  for (const session of sessions) stopPaperclipSession(session);
  return sessions;
}
