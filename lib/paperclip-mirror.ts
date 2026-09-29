/**
 * Mirror a tmux subagent as a Paperclip child issue.
 * Active only when a Paperclip run set the API env. Local pi is unchanged.
 */

import { paperclipEnv } from "./paperclip-questions.ts";

export const MIRROR_MARKER_PREFIX = "<!-- ultimate-pi-mirror:";

export type MirrorEnv = {
  apiUrl: string;
  apiKey: string;
  taskId: string;
  companyId: string;
};

export type MirrorLaunch = {
  agent: string;
  name: string;
  task: string;
};

export type MirrorClose = {
  name: string;
  exitCode: number | null;
  content: string;
};

type FetchLike = typeof fetch;

export function mirrorMarker(name: string): string {
  const safe = name.replace(/--/g, "").replace(/[<>]/g, "").trim() || "subagent";
  return `${MIRROR_MARKER_PREFIX}${safe} -->`;
}

export function isMirrorDescription(description: string): boolean {
  return description.includes(MIRROR_MARKER_PREFIX);
}

export function mirrorEnv(source: NodeJS.ProcessEnv = process.env): MirrorEnv | null {
  const base = paperclipEnv();
  if (!base) return null;
  if (source !== process.env) {
    const apiUrl = source.PAPERCLIP_API_URL?.trim();
    const apiKey = source.PAPERCLIP_API_KEY?.trim();
    const taskId = source.PAPERCLIP_TASK_ID?.trim();
    const companyId = source.PAPERCLIP_COMPANY_ID?.trim();
    if (!apiUrl || !apiKey || !taskId || !companyId) return null;
    return { apiUrl: apiUrl.replace(/\/$/, ""), apiKey, taskId, companyId };
  }
  const companyId = process.env.PAPERCLIP_COMPANY_ID?.trim();
  if (!companyId) return null;
  return { ...base, companyId };
}

export function mirrorDescription(task: string, name: string): string {
  const body = task.trim() || "Subagent task.";
  return `${body}\n\n${mirrorMarker(name)}\n`;
}

export function closeStatus(exitCode: number | null): "done" | "blocked" {
  return exitCode === 0 ? "done" : "blocked";
}

const CLOSED_MIRROR_STATUSES = new Set(["done", "cancelled"]);

export function mirrorShownBesidePane(title: string, paneLabels: readonly string[]): boolean {
  const name = title.trim();
  return name.length > 0 && paneLabels.some((label) => label.trim() === name);
}

type MirrorIssueRow = {
  id?: string;
  description?: string | null;
  status?: string;
};

function issueRows(body: unknown): MirrorIssueRow[] {
  if (Array.isArray(body)) return body as MirrorIssueRow[];
  if (body && typeof body === "object" && Array.isArray((body as { issues?: unknown }).issues)) {
    return (body as { issues: MirrorIssueRow[] }).issues;
  }
  return [];
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

export function launchFromToolResult(event: {
  toolName?: string;
  isError?: boolean;
  input?: Record<string, unknown>;
  details?: unknown;
}): MirrorLaunch | null {
  if (event.toolName !== "subagent" || event.isError) return null;
  const details = event.details;
  if (details && typeof details === "object" && "error" in details && (details as { error?: unknown }).error) return null;
  const input = event.input ?? {};
  const agent = typeof input.agent === "string" ? input.agent.trim() : "";
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : agent;
  const task = typeof input.task === "string" ? input.task : "";
  if (!agent || !name) return null;
  return { agent, name, task };
}

export function closeFromMessage(message: {
  role?: string;
  customType?: string;
  content?: unknown;
  details?: unknown;
}): MirrorClose | null {
  if (message.role !== "custom" || message.customType !== "subagent_result") return null;
  const details = message.details;
  if (!details || typeof details !== "object") return null;
  const record = details as { name?: unknown; exitCode?: unknown };
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name) return null;
  const exitCode = typeof record.exitCode === "number" ? record.exitCode : null;
  return { name, exitCode, content: textContent(message.content) };
}

function paperclipFetch(env: MirrorEnv, path: string, fetchImpl: FetchLike, init?: RequestInit): Promise<Response> {
  return fetchImpl(`${env.apiUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.apiKey}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export async function createMirrorIssue(input: {
  env: MirrorEnv;
  launch: MirrorLaunch;
  fetchImpl?: FetchLike;
}): Promise<string | null> {
  const request = input.fetchImpl ?? fetch;
  const marker = mirrorMarker(input.launch.name);
  const listed = await paperclipFetch(
    input.env,
    `/api/companies/${input.env.companyId}/issues?parentId=${encodeURIComponent(input.env.taskId)}`,
    request,
  );
  if (listed.ok) {
    const existing = issueRows(await listed.json()).find((issue) =>
      issue.id &&
      !CLOSED_MIRROR_STATUSES.has(issue.status ?? "") &&
      (issue.description ?? "").includes(marker));
    if (existing?.id) return existing.id;
  }
  const created = await paperclipFetch(input.env, `/api/issues/${input.env.taskId}/children`, request, {
    method: "POST",
    body: JSON.stringify({
      title: input.launch.name,
      description: mirrorDescription(input.launch.task, input.launch.name),
      status: "todo",
    }),
  });
  if (!created.ok) return null;
  const issue = await created.json() as { id?: string };
  return issue.id ?? null;
}

export async function closeMirrorIssue(input: {
  env: MirrorEnv;
  issueId: string;
  close: MirrorClose;
  fetchImpl?: FetchLike;
}): Promise<boolean> {
  const request = input.fetchImpl ?? fetch;
  const status = closeStatus(input.close.exitCode);
  const body = input.close.content.trim() || `Subagent ${input.close.name} finished with status ${status}.`;
  const commented = await paperclipFetch(input.env, `/api/issues/${input.issueId}/comments`, request, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
  if (!commented.ok) return false;
  const updated = await paperclipFetch(input.env, `/api/issues/${input.issueId}`, request, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  return updated.ok;
}

export function createMirrorSession() {
  const issues = new Map<string, string>();
  return {
    remember(name: string, issueId: string) {
      issues.set(name, issueId);
    },
    issueId(name: string) {
      return issues.get(name) ?? null;
    },
  };
}
