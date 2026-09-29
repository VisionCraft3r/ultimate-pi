import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type PaperclipChoice = {
  id: string;
  label: string;
  description?: string;
  freeText?: boolean;
};

export type PaperclipQuestion = {
  id: string;
  prompt: string;
  helpText?: string;
  selectionMode: "single" | "multi";
  required: boolean;
  allowOther: boolean;
  options: PaperclipChoice[];
};

export type PendingQuestion = {
  id: string;
  issueId: string;
  interactionId: string;
  title: string;
  questions: PaperclipQuestion[];
};

export type PaperclipAnswer = {
  questionId: string;
  optionIds: string[];
  otherText?: string | null;
};

type PaperclipEnv = {
  apiUrl: string;
  apiKey: string;
  taskId: string;
};

function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
}

export function questionQueuePath(dir = agentDir()): string {
  return join(dir, "paperclip-questions.json");
}

export function readQuestionQueue(dir = agentDir()): PendingQuestion[] {
  try {
    const parsed = JSON.parse(readFileSync(questionQueuePath(dir), "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as PendingQuestion[]) : [];
  } catch {
    return [];
  }
}

export function writeQuestionQueue(questions: PendingQuestion[], dir = agentDir()): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(questionQueuePath(dir), `${JSON.stringify(questions, null, 2)}\n`);
}

export function paperclipEnv(): PaperclipEnv | null {
  const apiUrl = process.env.PAPERCLIP_API_URL?.trim();
  const apiKey = process.env.PAPERCLIP_API_KEY?.trim();
  const taskId = process.env.PAPERCLIP_TASK_ID?.trim();
  if (!apiUrl || !apiKey || !taskId) return null;
  return { apiUrl: apiUrl.replace(/\/$/, ""), apiKey, taskId };
}

export function parseSubagentQuestion(prompt: string): { name: string; question: string } | null {
  const match = prompt.match(/Sub-agent "([^"]+)" asks[^\n]*:\s*\n\n([\s\S]*?)(?:\n\nReply with subagent_message|$)/);
  if (!match?.[1] || !match[2]?.trim()) return null;
  return { name: match[1], question: match[2].trim() };
}

function optionId(label: string, index: number): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return slug || `option-${index + 1}`;
}

export function formatSidecarQuestion(input: {
  question: string;
  details?: string;
  options?: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}): string {
  const lines = [input.question.trim()];
  const details = input.details?.trim();
  if (details) lines.push("", details);
  const options = (input.options ?? []).filter((option) => option.label.trim());
  if (options.length > 0) {
    lines.push("", input.multiSelect ? "Select any:" : "Options:");
    for (const option of options) {
      const hint = option.description?.trim() ? ` — ${option.description.trim()}` : "";
      lines.push(`- ${option.label.trim()}${hint}`);
    }
    lines.push("- Other");
  }
  return lines.join("\n");
}

export function questionsFromAsk(input: {
  question: string;
  details?: string;
  options?: Array<{ label: string; value?: string; description?: string }>;
  multiSelect?: boolean;
}): PaperclipQuestion[] {
  const provided = input.options?.filter((option) => option.label.trim()) ?? [];
  const options: PaperclipChoice[] = provided.length > 0
    ? provided.map((option, index) => ({
        id: optionId(option.value || option.label, index),
        label: option.label.trim(),
        ...(option.description ? { description: option.description } : {}),
      }))
    : [{ id: "answer", label: "Answer", freeText: true }];
  return [{
    id: "q1",
    prompt: input.question.trim(),
    ...(input.details?.trim() ? { helpText: input.details.trim() } : {}),
    selectionMode: input.multiSelect ? "multi" : "single",
    required: true,
    allowOther: true,
    options,
  }];
}

export function formatAnswers(questions: PaperclipQuestion[], answers: PaperclipAnswer[]): string {
  return answers.map((answer) => {
    const question = questions.find((item) => item.id === answer.questionId);
    const labels = answer.optionIds.map((id) => question?.options.find((option) => option.id === id)?.label ?? id);
    const other = answer.otherText?.trim();
    if (other && labels.length > 0) return `${labels.join(", ")} — ${other}`;
    if (other) return other;
    return labels.join(", ");
  }).filter((line) => line.length > 0).join("\n");
}

function paperclipFetch(env: PaperclipEnv, path: string, fetchImpl: typeof fetch, init?: RequestInit): Promise<Response> {
  return fetchImpl(`${env.apiUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.apiKey}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export async function askOnPaperclip(input: {
  title: string;
  questions: PaperclipQuestion[];
  fetchImpl?: typeof fetch;
}): Promise<{ text: string; answers: PaperclipAnswer[] } | { error: string }> {
  const env = paperclipEnv();
  if (!env) return { error: "Paperclip question env is not set." };
  const request = input.fetchImpl ?? fetch;
  const created = await paperclipFetch(env, `/api/issues/${env.taskId}/interactions`, request, {
    method: "POST",
    body: JSON.stringify({
      kind: "ask_user_questions",
      idempotencyKey: `ultimate-pi:${env.taskId}:${randomUUID()}`,
      title: input.title,
      resolverPolicy: "human_only",
      continuationPolicy: "none",
      payload: { version: 1, questions: input.questions },
    }),
  });
  if (!created.ok) return { error: `Paperclip question failed (${created.status}).` };
  const interaction = await created.json() as { id?: string };
  if (!interaction.id) return { error: "Paperclip did not return a question id." };
  const pending: PendingQuestion = {
    id: interaction.id,
    issueId: env.taskId,
    interactionId: interaction.id,
    title: input.title,
    questions: input.questions,
  };
  writeQuestionQueue([pending, ...readQuestionQueue().filter((item) => item.interactionId !== interaction.id)]);
  const started = Date.now();
  while (Date.now() - started < 30 * 60 * 1000) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const listed = await paperclipFetch(env, `/api/issues/${env.taskId}/interactions`, request);
    if (!listed.ok) continue;
    const interactions = await listed.json() as Array<{ id?: string; status?: string; result?: { answers?: PaperclipAnswer[] } }>;
    const match = interactions.find((item) => item.id === interaction.id);
    if (!match || match.status === "pending") continue;
    writeQuestionQueue(readQuestionQueue().filter((item) => item.interactionId !== interaction.id));
    if (match.status !== "answered" || !match.result?.answers) {
      return { error: `Question ${match.status ?? "ended"} before it was answered.` };
    }
    return { text: formatAnswers(input.questions, match.result.answers), answers: match.result.answers };
  }
  return { error: "Timed out waiting for the Paperclip answer." };
}
