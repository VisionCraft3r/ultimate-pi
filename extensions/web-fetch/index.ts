import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import dns from "node:dns";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { htmlToMarkdown, pdfToMarkdown } from "./convert.ts";
import { presentCapped } from "../../lib/output-cap.ts";
import { assertPublicUrl } from "./net-guard.ts";

/** Repo layout has package.json two levels up. The agent-dir copy does not. */
function readPackageVersion(): string {
	const packagePath = join(dirname(fileURLToPath(import.meta.url)), "../../package.json");
	if (!existsSync(packagePath)) return "0.0.0";
	try {
		const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
		return typeof parsed.version === "string" && parsed.version ? parsed.version : "0.0.0";
	} catch {
		return "0.0.0";
	}
}

const ULTIMATE_PI_VERSION = readPackageVersion();

export const USER_AGENT = `Mozilla/5.0 (compatible; ultimate-pi/${ULTIMATE_PI_VERSION})`;

const TIMEOUT_MS = 30_000;
const MAX_BYTES = 5 * 1024 * 1024;
const MIN_CONTENT = 160;
const JINA = "https://r.jina.ai/";

type ToolResult = { content: [{ type: "text"; text: string }]; details: Record<string, unknown> };

function result(text: string): ToolResult {
	return { content: [{ type: "text", text }], details: {} };
}

function asError(err: unknown): string {
	if (err instanceof Error && (err.name === "TimeoutError" || err.message.includes("The operation was aborted due to timeout"))) {
		return `Request timed out after ${TIMEOUT_MS}ms`;
	}
	return `Error: ${err instanceof Error ? err.message : String(err)}`;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description: "Fetch a URL and return readable content as markdown or plain text.",
		parameters: Type.Object({
			url: Type.String({ description: "HTTP or HTTPS URL to fetch" }),
		}),
		async execute(_toolCallId: string, { url }: { url: string }, signal?: AbortSignal) {
			try {
				return result(presentCapped(await load(url, signal)));
			} catch (err) {
				return result(asError(err));
			}
		},
	});
}

function parseHttpUrl(url: string): URL {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`Invalid URL: ${url}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("Only HTTP and HTTPS URLs are supported");
	}
	return parsed;
}

export function shouldUseJina(
	markdown: string,
	url: string,
	usedJina: boolean,
	env: Record<string, string | undefined> = process.env,
): boolean {
	if (env.ULTIMATE_PI_WEB_FETCH_JINA !== "1") return false;
	if (usedJina) return false;
	if (url.startsWith(JINA)) return false;
	return markdown.trim().length < MIN_CONTENT;
}

async function load(url: string, signal?: AbortSignal, usedJina = false): Promise<string> {
	const parsed = parseHttpUrl(url);
	const { headers, body } = await fetchPublic(url, signal);
	const ctype = (headers.get("content-type") ?? "").toLowerCase();
	const isPdf = ctype.includes("application/pdf") || parsed.pathname.toLowerCase().endsWith(".pdf");
	if (isPdf) return pdfToMarkdown(body);

	const raw = new TextDecoder("utf-8").decode(body);
	const isHtml =
		ctype.includes("text/html") || ctype.includes("application/xhtml") || /<(?:html|body|article)[\s>]/i.test(raw);
	if (!isHtml) return raw.trim();

	const markdown = await htmlToMarkdown(raw, url);
	if (shouldUseJina(markdown, url, usedJina)) {
		try {
			return await load(`${JINA}${url}`, signal, true);
		} catch {
			return markdown || raw;
		}
	}
	return markdown || raw;
}

const MAX_REDIRECTS = 5;

export type FetchPublicDeps = {
	fetchImpl?: typeof fetch;
	lookup?: typeof dns.promises.lookup;
};

export async function fetchPublic(
	url: string,
	signal?: AbortSignal,
	deps: FetchPublicDeps = {},
): Promise<{ headers: Headers; body: Uint8Array }> {
	const { fetchImpl = fetch, lookup } = deps;
	let current = parseHttpUrl(url);
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		if (hop === MAX_REDIRECTS) throw new Error("Too many redirects");
		await assertPublicUrl(current, lookup);
		const timeout = AbortSignal.timeout(TIMEOUT_MS);
		const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
		const res = await fetchImpl(current.toString(), {
			method: "GET",
			redirect: "manual",
			credentials: "omit",
			signal: combined,
			headers: {
				Accept: "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.8",
				"User-Agent": USER_AGENT,
			},
		});
		if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
			const location = res.headers.get("location")!;
			current = parseHttpUrl(new URL(location, current).toString());
			continue;
		}
		if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
		const declared = Number(res.headers.get("content-length") || 0);
		if (declared > MAX_BYTES) throw new Error(`Response too large (${declared} bytes; limit ${MAX_BYTES})`);
		return { headers: res.headers, body: await readBody(res) };
	}
	throw new Error("Too many redirects");
}

async function readBody(res: Response): Promise<Uint8Array> {
	if (!res.body) {
		const buf = new Uint8Array(await res.arrayBuffer());
		if (buf.byteLength > MAX_BYTES) throw new Error(`Response too large (${buf.byteLength} bytes; limit ${MAX_BYTES})`);
		return buf;
	}
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MAX_BYTES) {
			await reader.cancel().catch(() => undefined);
			throw new Error(`Response too large (limit ${MAX_BYTES} bytes)`);
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}
