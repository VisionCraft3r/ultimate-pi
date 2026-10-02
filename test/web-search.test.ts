import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import webSearch, { buildTavilyRequest, loadCredentials, parseHits, resolveAuthPath } from "../extensions/web-search/index.ts";

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
	const prev: Record<string, string | undefined> = {};
	for (const key of Object.keys(overrides)) {
		prev[key] = process.env[key];
		const value = overrides[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	try {
		fn();
	} finally {
		for (const [key, value] of Object.entries(prev)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

function withAuth(record: Record<string, unknown> | undefined, fn: (dir: string) => void): void {
	const dir = mkdtempSync(join(tmpdir(), "upi-web-search-"));
	try {
		if (record) {
			const authDir = join(dir, "extensions", "web-search");
			mkdirSync(authDir, { recursive: true });
			writeFileSync(join(authDir, "auth.json"), JSON.stringify(record));
		}
		withEnv({ PI_CODING_AGENT_DIR: dir, TAVILY_API_KEY: undefined }, () => fn(dir));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const key = "test-key-not-real";

test("auth.example.json is placeholders only", () => {
	const raw = readFileSync(new URL("../extensions/web-search/auth.example.json", import.meta.url), "utf8");
	assert.deepEqual(JSON.parse(raw), { tavily_api_key: "your-tavily-api-key-here" });
	assert.doesNotMatch(raw, /tvly-/);
	assert.doesNotMatch(raw, /AIza/);
});

test("resolveAuthPath uses PI_CODING_AGENT_DIR", () => {
	withAuth(undefined, (dir) => assert.equal(resolveAuthPath(), join(dir, "extensions", "web-search", "auth.json")));
});

test("loadCredentials reads TAVILY_API_KEY", () => {
	withAuth(undefined, () => withEnv({ TAVILY_API_KEY: key }, () => assert.deepEqual(loadCredentials(), { apiKey: key })));
});

test("loadCredentials reads file aliases in precedence order", () => {
	const names = ["tavily_api_key", "apiKey", "api_key", "TAVILY_API_KEY"];
	for (let i = 0; i < names.length; i++) {
		withAuth(Object.fromEntries(names.map((name, j) => [name, j < i ? " " : `${key}-${j}`])), () => {
			assert.deepEqual(loadCredentials(), { apiKey: `${key}-${i}` });
		});
	}
});

test("environment wins over file", () => {
	withAuth({ tavily_api_key: "file-key-not-real" }, () => withEnv({ TAVILY_API_KEY: key }, () => assert.deepEqual(loadCredentials(), { apiKey: key })));
});

test("placeholder credentials are missing", () => {
	withAuth({ tavily_api_key: "your-tavily-api-key-here" }, () => assert.equal(loadCredentials(), undefined));
	withAuth(undefined, () => withEnv({ TAVILY_API_KEY: "your-tavily-api-key-here" }, () => assert.equal(loadCredentials(), undefined)));
});

test("legacy-only environment is ignored", () => {
	withAuth(undefined, () => withEnv({ GOOGLE_SEARCH_API_KEY: key, GOOGLE_CSE_ID: "test-engine-not-real" }, () => assert.equal(loadCredentials(), undefined)));
});

test("buildTavilyRequest uses bearer POST and structured filters", () => {
	const request = buildTavilyRequest({ query: "pi", exactPhrases: ["a b"], excludeTerms: ["x"], site: "site:example.com", count: 50 }, key)!;
	assert.equal(request.url, "https://api.tavily.com/search");
	assert.equal(request.init.method, "POST");
	const headers = new Headers(request.init.headers);
	assert.equal(headers.get("Authorization"), `Bearer ${key}`);
	assert.equal(headers.get("Content-Type"), "application/json");
	const body = JSON.parse(request.init.body as string);
	assert.deepEqual(body, { query: 'pi "a b" -x', max_results: 10, search_depth: "basic", topic: "general", include_answer: false, include_domains: ["example.com"], exact_match: true });
	assert.equal("api_key" in body, false);
	assert.doesNotMatch(body.query, /site:/);
});

test("request defaults, count bounds and empty input", () => {
	const body = JSON.parse(buildTavilyRequest({ query: "pi" }, key)!.init.body as string);
	assert.equal(body.max_results, 5);
	assert.equal("include_domains" in body, false);
	assert.equal("exact_match" in body, false);
	assert.equal(buildTavilyRequest({}, key), undefined);
	for (const [count, expected] of [[0, 1], [-5, 1], [2.9, 2], [NaN, 5], [Infinity, 5]]) {
		assert.equal(JSON.parse(buildTavilyRequest({ query: "pi", count }, key)!.init.body as string).max_results, expected);
	}
});

test("parseHits maps Tavily content and ignores malformed items", () => {
	assert.deepEqual(parseHits({ results: [{ title: "T", url: "https://e.x", content: "C" }, null, { foo: 1 }] }), [{ title: "T", url: "https://e.x", snippet: "C" }]);
	assert.deepEqual(parseHits({}), []);
});

test("execute formats results and maps failures without real network", async () => {
	let execute!: (id: string, args: { query: string }) => Promise<{ content: { text: string }[] }>;
	webSearch({ registerTool(tool: { execute: typeof execute }) { execute = tool.execute; } } as unknown as ExtensionAPI);
	const originalFetch = globalThis.fetch;
	const originalKey = process.env.TAVILY_API_KEY;
	const originalDir = process.env.PI_CODING_AGENT_DIR;
	const dir = mkdtempSync(join(tmpdir(), "upi-web-search-"));
	try {
		process.env.PI_CODING_AGENT_DIR = dir;
		process.env.TAVILY_API_KEY = key;
		globalThis.fetch = async (url, init) => {
			assert.equal(url, "https://api.tavily.com/search");
			assert.equal(init?.method, "POST");
			assert.ok(init?.signal);
			return new Response(JSON.stringify({ results: [{ title: "T", url: "https://e.x", content: "C" }] }));
		};
		assert.equal((await execute("test", { query: "pi" })).content[0].text, "1. T\n   https://e.x\n   C");
		for (const [status, message] of [
			[401, "Tavily rejected the API key."],
			[429, "Tavily rate limit — retry later."],
			[432, "Tavily usage limit reached for this key/plan."],
			[433, "Tavily usage limit reached for this key/plan."],
			[500, ""],
		] as const) {
			globalThis.fetch = async () => new Response("", { status });
			assert.equal((await execute("test", { query: "pi" })).content[0].text, message ? `Web search failed (${status}): ${message}` : `Web search failed (${status}).`);
		}
		globalThis.fetch = async () => new Response("not json");
		assert.equal((await execute("test", { query: "pi" })).content[0].text, "Web search returned an invalid response.");
		for (const [name, expected] of [["Error", "Web search request failed."], ["TimeoutError", "Web search timed out."], ["AbortError", "Web search timed out."]]) {
			globalThis.fetch = async () => { const error = new Error("fake"); error.name = name; throw error; };
			assert.equal((await execute("test", { query: "pi" })).content[0].text, expected);
		}
		delete process.env.TAVILY_API_KEY;
		globalThis.fetch = async () => { assert.fail("missing credentials must not fetch"); };
		assert.equal((await execute("test", { query: "pi" })).content[0].text, "Missing Tavily credentials. Set TAVILY_API_KEY, run `ultimate-pi setup web-search`, or create auth.json from auth.example.json under <agentDir>/extensions/web-search/.");
	} finally {
		globalThis.fetch = originalFetch;
		if (originalKey === undefined) delete process.env.TAVILY_API_KEY;
		else process.env.TAVILY_API_KEY = originalKey;
		if (originalDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = originalDir;
		rmSync(dir, { recursive: true, force: true });
	}
});
