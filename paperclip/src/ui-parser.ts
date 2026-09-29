type TranscriptEntry = { kind: "message" | "tool" | "error" | "stdout"; text: string };

export function parseStdoutLine(line: string): TranscriptEntry[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  if (!trimmed.startsWith("{")) return [{ kind: "stdout", text: line }];
  try {
    const event = JSON.parse(trimmed) as { type?: string; message?: { content?: unknown; errorMessage?: string } };
    if (event.type === "turn_end" || event.type === "message_end") {
      const content = event.message?.content;
      const text = typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((part) => (part && typeof part === "object" && "text" in part ? String(part.text ?? "") : "")).join("")
          : "";
      if (event.message?.errorMessage) return [{ kind: "error", text: event.message.errorMessage }];
      if (text) return [{ kind: "message", text }];
    }
    if (event.type === "tool_execution_start") return [{ kind: "tool", text: trimmed }];
  } catch {
    return [{ kind: "stdout", text: line }];
  }
  return [{ kind: "stdout", text: line }];
}
