import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  collectProviders,
  providersMissingAuth,
  yesModeAuthError,
} from "../installer/providers.mjs";
import { mergeModelsJson } from "../installer/models-json.mjs";
import { assignAgentModels } from "../installer/agents.mjs";
import { createBackupSession } from "../installer/backup.mjs";

test("collectProviders normalizes api_key to api-key and keeps OpenRouter credential", async () => {
  const { providers } = await collectProviders({
    answers: {
      providers: [
        { id: "anthropic", authMethod: "oauth" },
        { id: "openrouter", authMethod: "api_key", credential: "test-key-not-real" },
      ],
    },
  });

  const anthropic = providers.find((row) => row.id === "anthropic");
  const openrouter = providers.find((row) => row.id === "openrouter");

  assert.equal(anthropic?.authMethod, "oauth");
  assert.equal(anthropic?.credential, undefined);
  assert.equal(openrouter?.authMethod, "api-key");
  assert.equal(openrouter?.credential, "test-key-not-real");
});

test("collectProviders --yes selects OAuth providers without credentials", async () => {
  const { providers } = await collectProviders({ yes: true });
  assert.deepEqual(
    providers.map((row) => row.id),
    ["anthropic", "openai-codex", "cursor"],
  );
  for (const row of providers) {
    assert.equal(row.authMethod, "oauth");
    assert.equal(row.credential, undefined);
  }
});

test("providersMissingAuth treats API keys and existing auth.json entries as ready", () => {
  const missing = providersMissingAuth(
    [
      { id: "anthropic", authMethod: "oauth" },
      { id: "openrouter", authMethod: "api-key", credential: "test-key-not-real" },
    ],
    { anthropic: { type: "oauth" } },
  );
  assert.deepEqual(missing, []);
});

test("yesModeAuthError tells --yes users to pi login before any apply", async () => {
  const { providers } = await collectProviders({ yes: true });
  const message = yesModeAuthError(providers, {});
  assert.match(message ?? "", /pi login/);
  assert.match(message ?? "", /anthropic/);
  assert.match(message ?? "", /openai-codex/);
  assert.match(message ?? "", /cursor/);
  assert.match(message ?? "", /then re-run install/);
  assert.match(message ?? "", /No settings or packages were applied/);
  assert.equal(
    yesModeAuthError(providers, {
      anthropic: { type: "oauth" },
      "openai-codex": { type: "oauth" },
      cursor: { type: "oauth" },
    }),
    null,
  );
  assert.equal(
    yesModeAuthError(
      [{ id: "openrouter", authMethod: "api-key", credential: "test-key-not-real" }],
      {},
    ),
    null,
  );
});

test("local answers accept a model string, default the API, and use the placeholder key", async () => {
  const { providers } = await collectProviders({
    answers: {
      providers: [
        {
          id: "ollama",
          baseUrl: "http://127.0.0.1:11434/v1",
          model: "qwen2.5-coder:7b",
        },
      ],
    },
  });
  assert.deepEqual(providers, [
    {
      id: "ollama",
      authMethod: "api-key",
      baseUrl: "http://127.0.0.1:11434/v1",
      api: "openai-completions",
      models: ["qwen2.5-coder:7b"],
      credential: "local",
    },
  ]);
  assert.equal(yesModeAuthError(providers, {}), null);
});

test("local answers reject a reserved provider id and a non-http base URL", async () => {
  await assert.rejects(
    () =>
      collectProviders({
        answers: {
          providers: [{ id: "openai", baseUrl: "http://127.0.0.1:11434/v1", models: ["x"] }],
        },
      }),
    /reserved/,
  );
  await assert.rejects(
    () =>
      collectProviders({
        answers: {
          providers: [{ id: "ollama", baseUrl: "localhost:11434", models: ["x"] }],
        },
      }),
    /http\(s\) baseUrl/,
  );
});

test("mergeModelsJson keeps other providers and does not write the API key", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ultimate-pi-models-"));
  try {
    await writeFile(
      path.join(dir, "models.json"),
      `${JSON.stringify({ providers: { cloud: { baseUrl: "https://example.test/v1", models: [{ id: "keep" }] } } }, null, 2)}\n`,
    );
    const backup = createBackupSession(dir);
    const next = await mergeModelsJson(
      dir,
      [
        {
          id: "ollama",
          baseUrl: "http://127.0.0.1:11434/v1",
          api: "openai-completions",
          models: ["qwen2.5-coder:7b"],
          credential: "secret-key-not-written",
        },
      ],
      backup,
    );
    assert.equal(next.providers.cloud.models[0].id, "keep");
    assert.equal(next.providers.ollama.baseUrl, "http://127.0.0.1:11434/v1");
    assert.deepEqual(next.providers.ollama.models, [{ id: "qwen2.5-coder:7b" }]);
    assert.equal(next.providers.ollama.apiKey, undefined);
    const raw = await readFile(path.join(dir, "models.json"), "utf8");
    assert.doesNotMatch(raw, /secret-key-not-written/);
    const sessions = (await readdir(path.join(dir, "backups"))).filter((name) => name.startsWith("ultimate-pi-"));
    assert.equal(sessions.length, 1);
    assert.match(await readFile(path.join(dir, "backups", sessions[0], "models.json"), "utf8"), /"cloud"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("yes-mode assignment uses a local model id instead of default", async () => {
  const onlyLocal = await assignAgentModels({ yes: true }, [
    { id: "ollama", models: ["qwen2.5-coder:7b"] },
  ]);
  assert.equal(onlyLocal.worker.provider, "ollama");
  assert.equal(onlyLocal.worker.model, "qwen2.5-coder:7b");

  const mixed = await assignAgentModels({ yes: true }, [
    { id: "ollama", models: ["qwen2.5-coder:7b"] },
    { id: "cursor" },
  ]);
  assert.equal(mixed.scout.provider, "cursor");
  assert.equal(mixed.scout.model, "composer-1.5");
  assert.equal(mixed.researcher.provider, "ollama");
  assert.equal(mixed.researcher.model, "qwen2.5-coder:7b");
  assert.equal(mixed.worker.provider, "cursor");
  assert.equal(mixed.reviewer.provider, "ollama");
  assert.equal(mixed.reviewer.model, "qwen2.5-coder:7b");
  assert.equal(onlyLocal.reviewer.provider, "ollama");
  assert.equal(onlyLocal.reviewer.model, "qwen2.5-coder:7b");
});

test("answers that omit reviewer copy the planner assignment into a distinct entry", async () => {
  const assigned = await assignAgentModels({
    answers: {
      agentAssignments: {
        scout: { provider: "cursor", model: "composer-1.5" },
        worker: { provider: "cursor", model: "grok-4.5" },
        planner: { provider: "anthropic", model: "claude-opus-4.6" },
        researcher: { provider: "openai-codex", model: "gpt-5.4" },
        qa_tester: { provider: "openrouter", model: "openai/gpt-4.1-mini" },
      },
    },
  }, []);
  assert.equal(assigned.reviewer.provider, "anthropic");
  assert.equal(assigned.reviewer.model, "claude-opus-4.6");
  assert.equal(assigned.planner.model, "claude-opus-4.6");
  assigned.reviewer.model = "claude-sonnet-4.6";
  assert.equal(assigned.planner.model, "claude-opus-4.6");
});

test("yes-mode reviewer prefers a provider other than the worker", async () => {
  const assigned = await assignAgentModels({ yes: true }, [
    { id: "cursor" },
    { id: "anthropic" },
  ]);
  assert.equal(assigned.worker.provider, "cursor");
  assert.equal(assigned.reviewer.provider, "anthropic");
  assert.notEqual(assigned.reviewer.provider, assigned.worker.provider);
});
