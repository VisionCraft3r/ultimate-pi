/**
 * A worker DONE claim needs a Verification section that names a command.
 * One continuation steer; the next settle is left alone.
 */

export const VERIFY_GATE_REASON =
	"Status is DONE but Verification has no command. Add ## Verification with the exact command in backticks and its pass or fail result, or change Status to BLOCKED.";

type Entry = { type?: string; message?: { role?: string; content?: unknown }; role?: string; content?: unknown };

export function statusIsDone(text: string): boolean {
	const match = text.match(/^##\s*Status\s*\n+([^\n]+)/im);
	if (!match) return false;
	const line = match[1].trim();
	if (/^BLOCKED\b/i.test(line)) return false;
	return /^DONE\b/i.test(line);
}

export function verificationHasCommand(text: string): boolean {
	const match = text.match(/^##\s*Verification\s*\n([\s\S]*?)(?=^##\s|\s*$)/im);
	if (!match) return false;
	return /`[^`\n]+`/.test(match[1]);
}

export function missingDoneVerification(text: string): boolean {
	return statusIsDone(text) && !verificationHasCommand(text);
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(part): part is { type: string; text: string } =>
				Boolean(part) &&
				typeof part === "object" &&
				(part as { type?: string }).type === "text" &&
				typeof (part as { text?: unknown }).text === "string",
		)
		.map((part) => part.text)
		.join("\n");
}

export function lastAssistantText(ctx: { sessionManager?: { getEntries?: () => unknown[] } } | undefined): string {
	const entries = (ctx?.sessionManager?.getEntries?.() ?? []) as Entry[];
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		const msg = entry?.message ?? entry;
		if (!msg || typeof msg !== "object") continue;
		if ((msg as { role?: string }).role !== "assistant") continue;
		return contentText((msg as { content?: unknown }).content);
	}
	return "";
}

export function verifyGateAction(
	text: string,
	alreadyNudged: boolean,
): { nudge: true; reason: string } | undefined {
	if (alreadyNudged || !missingDoneVerification(text)) return undefined;
	return { nudge: true, reason: VERIFY_GATE_REASON };
}
