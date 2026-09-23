import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadCredentials, resolveAuthPath } from "./credentials.ts";

export { loadCredentials, resolveAuthPath };

const CSE_ENDPOINT = "https://www.googleapis.com/customsearch/v1";
const SEARCH_TIMEOUT_MS = 15_000;

type SearchArgs = {
	query?: string;
	exactPhrases?: string | string[];
	excludeTerms?: string | string[];
	site?: string;
	count?: number;
};

type SearchHit = { title: string; url: string; snippet: string };

function terms(value: string | string[] | undefined): string[] {
	if (value == null) return [];
	const parts = Array.isArray(value) ? value : value.trim().split(/\s+/);
	return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function clampCount(count: number | undefined): number {
	if (typeof count !== "number" || !Number.isFinite(count)) return 5;
	return Math.min(10, Math.max(1, Math.trunc(count)));
}

function composeQuery(args: SearchArgs): string {
	const chunks: string[] = [];
	const query = args.query?.trim();
	if (query) chunks.push(query);
	for (const phrase of terms(args.exactPhrases)) chunks.push(`"${phrase.replaceAll('"', "")}"`);
	for (const term of terms(args.excludeTerms)) chunks.push(term.startsWith("-") ? term : `-${term}`);
	const site = args.site?.trim().replace(/^site:/i, "");
	if (site) chunks.push(`site:${site}`);
	return chunks.join(" ").trim();
}

function toolResult(text: string) {
	return { content: [{ type: "text" as const, text }], details: {} };
}

function parseHits(payload: unknown): SearchHit[] {
	if (!payload || typeof payload !== "object" || !("items" in payload)) return [];
	const items = (payload as { items?: unknown }).items;
	if (!Array.isArray(items)) return [];
	const hits: SearchHit[] = [];
	for (const item of items) {
		if (!item || typeof item !== "object") continue;
		const rec = item as Record<string, unknown>;
		const title = typeof rec.title === "string" ? rec.title : "";
		const url = typeof rec.link === "string" ? rec.link : "";
		const snippet = typeof rec.snippet === "string" ? rec.snippet : "";
		if (title || url) hits.push({ title, url, snippet });
	}
	return hits;
}

function formatHits(hits: SearchHit[]): string {
	if (hits.length === 0) return "No results found.";
	return hits
		.map((hit, index) => `${index + 1}. ${hit.title}\n   ${hit.url}\n   ${hit.snippet}`.trimEnd())
		.join("\n\n");
}

export default function webSearch(pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web via Google Custom Search. Optional exact phrases, excluded terms, site filter, and result count (1-10).",
		parameters: Type.Object({
			query: Type.Optional(Type.String()),
			exactPhrases: Type.Optional(Type.Array(Type.String())),
			excludeTerms: Type.Optional(Type.Array(Type.String())),
			site: Type.Optional(Type.String()),
			count: Type.Optional(Type.Number()),
		}),
		async execute(_toolCallId, args: SearchArgs) {
			const params = args ?? {};
			const q = composeQuery(params);
			if (!q) return toolResult("Provide a non-empty query or exactPhrases.");
			const creds = loadCredentials();
			if (!creds) {
				return toolResult(
					"Missing Google Custom Search credentials. Set GOOGLE_SEARCH_API_KEY and GOOGLE_CSE_ID (or GOOGLE_API_KEY and GOOGLE_CUSTOM_SEARCH_ENGINE_ID), or create auth.json from auth.example.json under the agent dir.",
				);
			}
			let response: Response;
			try {
				const url = new URL(CSE_ENDPOINT);
				url.searchParams.set("q", q);
				url.searchParams.set("key", creds.apiKey);
				url.searchParams.set("cx", creds.cseId);
				url.searchParams.set("num", String(clampCount(params.count)));
				response = await fetch(url, { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
			} catch (error) {
				const timedOut =
					error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
				return toolResult(timedOut ? "Web search timed out." : "Web search request failed.");
			}
			if (!response.ok) return toolResult(`Web search failed (${response.status}).`);
			try {
				const hits = parseHits(await response.json());
				return toolResult(formatHits(hits));
			} catch {
				return toolResult("Web search returned an invalid response.");
			}
		},
	});
}
