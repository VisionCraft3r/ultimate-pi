import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectProviders,
  providersMissingAuth,
  yesModeAuthError,
} from "../installer/providers.mjs";

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
