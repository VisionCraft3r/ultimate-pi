import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadCredentials, resolveAuthPath } from "../extensions/web-search/index.ts";

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

test("auth.example.json is placeholders only", () => {
	const raw = readFileSync(
		new URL("../extensions/web-search/auth.example.json", import.meta.url),
		"utf8",
	);
	const example = JSON.parse(raw) as {
		google_search_api_key?: string;
		google_cse_id?: string;
	};
	assert.equal(example.google_search_api_key, "your-google-api-key-here");
	assert.equal(example.google_cse_id, "your-google-cse-id-here");
	assert.doesNotMatch(raw, /AIza/);
});

test("resolveAuthPath uses PI_CODING_AGENT_DIR", () => {
	withEnv({ PI_CODING_AGENT_DIR: "/tmp/upi-web-search-agent" }, () => {
		assert.equal(
			resolveAuthPath(),
			"/tmp/upi-web-search-agent/extensions/web-search/auth.json",
		);
	});
});

test("loadCredentials prefers GOOGLE_SEARCH_API_KEY + GOOGLE_CSE_ID", () => {
	withEnv(
		{
			PI_CODING_AGENT_DIR: "/tmp/upi-web-search-unused",
			GOOGLE_SEARCH_API_KEY: "test-key-not-real",
			GOOGLE_CSE_ID: "test-cse-id-not-real",
			GOOGLE_API_KEY: undefined,
			GOOGLE_CUSTOM_SEARCH_ENGINE_ID: undefined,
		},
		() => {
			assert.deepEqual(loadCredentials(), {
				apiKey: "test-key-not-real",
				cseId: "test-cse-id-not-real",
			});
		},
	);
});

test("loadCredentials accepts GOOGLE_API_KEY + GOOGLE_CUSTOM_SEARCH_ENGINE_ID aliases", () => {
	withEnv(
		{
			PI_CODING_AGENT_DIR: "/tmp/upi-web-search-unused",
			GOOGLE_SEARCH_API_KEY: undefined,
			GOOGLE_CSE_ID: undefined,
			GOOGLE_API_KEY: "test-key-not-real",
			GOOGLE_CUSTOM_SEARCH_ENGINE_ID: "test-cse-id-not-real",
		},
		() => {
			assert.deepEqual(loadCredentials(), {
				apiKey: "test-key-not-real",
				cseId: "test-cse-id-not-real",
			});
		},
	);
});

test("loadCredentials reads agent-dir auth.json when env is unset", () => {
	const agentDir = mkdtempSync(join(tmpdir(), "upi-web-search-"));
	try {
		const authDir = join(agentDir, "extensions", "web-search");
		mkdirSync(authDir, { recursive: true });
		writeFileSync(
			join(authDir, "auth.json"),
			JSON.stringify({
				google_search_api_key: "test-key-not-real",
				google_cse_id: "test-cse-id-not-real",
			}),
		);
		withEnv(
			{
				PI_CODING_AGENT_DIR: agentDir,
				GOOGLE_SEARCH_API_KEY: undefined,
				GOOGLE_CSE_ID: undefined,
				GOOGLE_API_KEY: undefined,
				GOOGLE_CUSTOM_SEARCH_ENGINE_ID: undefined,
			},
			() => {
				assert.deepEqual(loadCredentials(), {
					apiKey: "test-key-not-real",
					cseId: "test-cse-id-not-real",
				});
			},
		);
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});
