/**
 * Parent-only. When a reviewer verdict shows up in the session, record it
 * on the opt-in routing trace. The parser itself stays pure.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { noteIfReviewVerdict } from "../lib/review-verdict.ts";

type MaybeMessage = { role?: string; content?: unknown };

function textOf(message: MaybeMessage | undefined): string {
	const content = message?.content;
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

export default function (pi: ExtensionAPI) {
	if (process.env.PI_SUBAGENT_AGENT) return;
	pi.on("message_end", (event) => {
		noteIfReviewVerdict(textOf(event.message as MaybeMessage));
	});
}
