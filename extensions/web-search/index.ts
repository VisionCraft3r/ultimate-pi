import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadCredentials, resolveAuthPath } from "./credentials.ts";

export { loadCredentials, resolveAuthPath };

const TAVILY_ENDPOINT = "https://api.tavily.com/search";
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
	return chunks.join(" ").trim();
}

export function buildTavilyRequest(args: SearchArgs, apiKey: string): { url: string; init: RequestInit } | undefined {
	const query = composeQuery(args);
	if (!query) return undefined;
	const site = args.site?.trim().replace(/^site:/i, "");
	const body = {
		query,
		max_results: clampCount(args.count),
		search_depth: "basic",
		topic: "general",
		include_answer: false,
		...(site ? { include_domains: [site] } : {}),
		...(terms(args.exactPhrases).length > 0 ? { exact_match: true } : {}),
	};
	return {
		url: TAVILY_ENDPOINT,
		init: {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
			body: JSON.stringify(body),
		},
	};
}

function toolResult(text: string) {
	return { content: [{ type: "text" as const, text }], details: {} };
}

export function parseHits(payload: unknown): SearchHit[] {
	if (!payload || typeof payload !== "object" || !("results" in payload)) return [];
	const items = (payload as { results?: unknown }).results;
	if (!Array.isArray(items)) return [];
	const hits: SearchHit[] = [];
	for (const item of items) {
		if (!item || typeof item !== "object") continue;
		const rec = item as Record<string, unknown>;
		const title = typeof rec.title === "string" ? rec.title : "";
		const url = typeof rec.url === "string" ? rec.url : "";
		const snippet = typeof rec.content === "string" ? rec.content : "";
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
			"Search the web via Tavily. Optional exact phrases, excluded terms, site filter, and result count (1-10).",
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
					"Missing Tavily credentials. Set TAVILY_API_KEY, run `ultimate-pi setup web-search`, or create auth.json from auth.example.json under <agentDir>/extensions/web-search/.",
				);
			}
			let response: Response;
			try {
				const request = buildTavilyRequest(params, creds.apiKey);
				if (!request) return toolResult("Provide a non-empty query or exactPhrases.");
				response = await fetch(TAVILY_ENDPOINT, { ...request.init, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
			} catch (error) {
				const timedOut =
					error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
				return toolResult(timedOut ? "Web search timed out." : "Web search request failed.");
			}
			if (!response.ok) {
				const status = response.status;
				if (status === 401) return toolResult("Web search failed (401): Tavily rejected the API key.");
				if (status === 429) return toolResult("Web search failed (429): Tavily rate limit — retry later.");
				if (status === 432 || status === 433) return toolResult(`Web search failed (${status}): Tavily usage limit reached for this key/plan.`);
				return toolResult(`Web search failed (${status}).`);
			}
			try {
				const hits = parseHits(await response.json());
				return toolResult(formatHits(hits));
			} catch {
				return toolResult("Web search returned an invalid response.");
			}
		},
	});
}
