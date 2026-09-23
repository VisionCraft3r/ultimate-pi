import { test } from "node:test";
import assert from "node:assert/strict";
import { collectProviders } from "../installer/providers.mjs";

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
