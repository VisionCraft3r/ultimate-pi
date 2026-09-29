export type ParsedPiOutput = {
  messages: string[];
  errors: string[];
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  finalMessage: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const record = asRecord(part);
      return record?.type === "text" ? asString(record.text) : "";
    })
    .join("");
}

/** A short closer that points at a result which was never posted. */
export function isResultPointer(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 400) return false;
  return /posted above|summary posted|see above/i.test(trimmed);
}

/** Last assistant answer that is the work itself, skipping "summary posted above". */
export function deliverableSummary(messages: readonly string[]): string {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const message of messages) {
    const text = message.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    unique.push(text);
  }
  for (let i = unique.length - 1; i >= 0; i -= 1) {
    const text = unique[i] ?? "";
    if (!isResultPointer(text)) return text;
  }
  return unique.at(-1) ?? "";
}

export function parsePiJsonl(stdout: string): ParsedPiOutput {
  const result: ParsedPiOutput = {
    messages: [],
    errors: [],
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    finalMessage: null,
  };

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("{")) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const eventType = asString(event.type);
    if (eventType === "error") {
      const message = asString(event.message).trim();
      if (message) result.errors.push(message);
    }
    if (eventType === "turn_end" || eventType === "message_end") {
      const message = asRecord(event.message);
      if (message?.role === "assistant") {
        const text = extractText(message.content);
        if (text) {
          result.finalMessage = text;
          result.messages.push(text);
        }
        if (message.stopReason === "error") {
          const error = asString(message.errorMessage).trim() || "Pi provider request failed.";
          if (!result.errors.includes(error)) result.errors.push(error);
        }
        const usage = asRecord(message.usage);
        if (usage) {
          result.usage.inputTokens += asNumber(usage.input);
          result.usage.outputTokens += asNumber(usage.output);
          const cost = asRecord(usage.cost);
          if (cost) result.usage.costUsd += asNumber(cost.total);
        }
      }
    }
  }
  return result;
}

export function extensionStartupError(text: string): string | null {
  const plain = text.replace(/\u001b\[[0-9;]*m/g, "");
  const match = plain.match(/Failed to load extension[^\r\n]*/);
  if (match?.[0]) return match[0].trim();
  if (/does not export a valid factory function/.test(plain)) {
    return "Pi refused to start because an extensions/ file is not an extension factory.";
  }
  return null;
}

export function isUnknownSessionError(stdout: string, stderr: string): boolean {
  return /unknown\s+session|session\s+not\s+found|no\s+session/i.test(`${stdout}\n${stderr}`);
}
