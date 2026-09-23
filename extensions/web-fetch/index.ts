import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { htmlToMarkdown, pdfToMarkdown } from "./convert.ts";

export const USER_AGENT = "Mozilla/5.0 (compatible; ultimate-pi/1.0.0-alpha)";

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
				return result(await load(url, signal));
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

async function load(url: string, signal?: AbortSignal, usedJina = false): Promise<string> {
	const parsed = parseHttpUrl(url);
	const { headers, body } = await get(url, signal);
	const ctype = (headers.get("content-type") ?? "").toLowerCase();
	const isPdf = ctype.includes("application/pdf") || parsed.pathname.toLowerCase().endsWith(".pdf");
	if (isPdf) return pdfToMarkdown(body);

	const raw = new TextDecoder("utf-8").decode(body);
	const isHtml =
		ctype.includes("text/html") || ctype.includes("application/xhtml") || /<(?:html|body|article)[\s>]/i.test(raw);
	if (!isHtml) return raw.trim();

	const markdown = htmlToMarkdown(raw, url);
	if (!usedJina && markdown.trim().length < MIN_CONTENT && !url.startsWith(JINA)) {
		try {
			return await load(`${JINA}${url}`, signal, true);
		} catch {
			return markdown || raw;
		}
	}
	return markdown || raw;
}

async function get(url: string, signal?: AbortSignal): Promise<{ headers: Headers; body: Uint8Array }> {
	const timeout = AbortSignal.timeout(TIMEOUT_MS);
	const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
	const res = await fetch(url, {
		method: "GET",
		redirect: "follow",
		credentials: "omit",
		signal: combined,
		headers: {
			Accept: "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.8",
			"User-Agent": USER_AGENT,
		},
	});
	if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
	const declared = Number(res.headers.get("content-length") || 0);
	if (declared > MAX_BYTES) throw new Error(`Response too large (${declared} bytes; limit ${MAX_BYTES})`);
	return { headers: res.headers, body: await readBody(res) };
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
