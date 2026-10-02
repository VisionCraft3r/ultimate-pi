# Providers

Ultimate Pi talks to models through [Pi](https://pi.dev)'s provider layer. You pick one or more providers during `ultimate-pi install`, or later with:

```bash
ultimate-pi setup providers
```

That command is a **selection + credential capture** loop. It does not talk to the model APIs itself.

- **OAuth providers** (`anthropic`, `openai-codex`, `cursor`): the installer prints Pi `/login` steps, waits for you to confirm they succeeded, and leaves the tokens Pi writes in `<agentDir>/auth.json` untouched.
- **API-key providers** (`openrouter`, `deepseek`, `openai`, `other`): the installer prompts for a masked key and merges `{ "<id>": { "type": "api_key", "key": "…" } }` into `<agentDir>/auth.json` (mode `0600`, existing file backed up to `auth.json.bak`).

Keys are never echoed, logged, or passed on the command line. Environment variables, where listed below, are an alternative to storing the key in `auth.json` — Pi reads them directly.

`--yes` selects `anthropic`, `openai-codex`, and `cursor` (OAuth only; no keys collected). `--dry-run` records the choice without prompting or writing. `--answers <file.json>` supplies the list non-interactively (see `test/fixtures/answers.json`).

**Ultimate Pi is not affiliated with Anthropic, OpenAI, Cursor, OpenRouter, DeepSeek, or TypeSafe AI.** You bring your own accounts.

## Anthropic (`anthropic`)

OAuth via Pi `/login`, or an API key in the environment.

**Prepare**

- An Anthropic account that can complete Pi's `/login` flow, **or**
- an API key from the Anthropic console.

**Env var:** `ANTHROPIC_API_KEY`

**What `ultimate-pi setup providers` does**

1. Marks the provider as OAuth.
2. Tells you to run `pi`, then `/login`, complete the Anthropic login, and confirm.
3. On apply, installs [`@gotgenes/pi-anthropic-auth`](https://www.npmjs.com/package/@gotgenes/pi-anthropic-auth) so Pi's Anthropic OAuth path is available.
4. Does **not** write the OAuth token — Pi does that. Does **not** prompt for `ANTHROPIC_API_KEY`; export that yourself if you prefer key auth over `/login`.

## OpenAI Codex (`openai-codex`)

OAuth via Pi `/login`, using a ChatGPT / Codex account (not an `OPENAI_API_KEY`).

**Prepare**

- A ChatGPT account that Pi's Codex `/login` accepts.

**Env var:** none for this OAuth path. (Plain OpenAI API keys are the separate `openai` provider below.)

**What `ultimate-pi setup providers` does**

1. Marks the provider as OAuth.
2. Tells you to run `pi`, then `/login`, complete the Codex / ChatGPT login, and confirm.
3. Leaves Pi's OAuth entry in `auth.json` alone.

## Cursor (`cursor`)

OAuth via [`@schultzp2020/pi-cursor`](https://www.npmjs.com/package/@schultzp2020/pi-cursor), then Pi `/login`.

**Prepare**

- A Cursor account that the `pi-cursor` login flow accepts.

**Env var:** none. Auth is the OAuth token Pi writes after `/login`.

**What `ultimate-pi setup providers` does**

1. Marks the provider as OAuth.
2. Tells you to run `pi`, then `/login`, complete the Cursor login, and confirm.
3. On apply, installs `@schultzp2020/pi-cursor` (required for Pi to expose Cursor as a provider). Run `/login` **after** that package is installed if the first attempt could not see Cursor yet.

## OpenRouter (`openrouter`)

API key. Also powers **JEV** (`typesafe/jev-1.13` via OpenRouter). Without this key, JEV falls back to a local keyword heuristic. See [docs/jev.md](./jev.md).

**Prepare**

- An OpenRouter API key with access to the models you want, and to JEV if you want live triage.

**Env var:** `OPENROUTER_API_KEY` (alternative to storing the key in `auth.json`)

**What `ultimate-pi setup providers` does**

1. Prompts for a masked API key (`API key for openrouter`).
2. Merges it into `auth.json` as `openrouter.key`.
3. If this key is present, the JEV step can run in OpenRouter mode; if you skip OpenRouter entirely, you can still paste a key later during the JEV / optional-packages step, or re-run `ultimate-pi setup jev`.

## DeepSeek (`deepseek`)

API key. Also powers optional **observational memory** (`pi-observational-memory`).

**Prepare**

- A DeepSeek API key.

**Env var:** `DEEPSEEK_API_KEY`

**What `ultimate-pi setup providers` does**

1. Prompts for a masked API key (`API key for deepseek`).
2. Merges it into `auth.json` as `deepseek.key`.
3. Selecting DeepSeek here is independent of the later memory step — `ultimate-pi setup memory` can collect a DeepSeek key just for the observer even if you did not add DeepSeek as a model provider.

## OpenAI (`openai`)

API key for the OpenAI platform API (not the Codex OAuth provider above).

**Prepare**

- An OpenAI API key from platform.openai.com.

**Env var:** `OPENAI_API_KEY`

**What `ultimate-pi setup providers` does**

1. Prompts for a masked API key (`API key for openai`).
2. Merges it into `auth.json` as `openai.key`.

## Local model (OpenAI-compatible)

A server you run yourself: Ollama, LM Studio, vLLM, SGLang, or any other endpoint that speaks the OpenAI completions API. This is separate from **Other**, which only stores an API key and does not ask for a base URL.

Pi's llama.cpp router (`/llama`) is a different path. This installer option does not start that router.

**Prepare**

- The server listening on an `http://` or `https://` URL. The default prompt is `http://127.0.0.1:11434/v1` (Ollama's OpenAI-compatible port).
- A provider id slug such as `local` or `ollama`. Built-in ids (`anthropic`, `openai`, `openai-codex`, `cursor`, `openrouter`, `deepseek`, `other`) are rejected.
- At least one model id the server actually serves, for example `qwen2.5-coder:7b`.

**What `ultimate-pi install` / `ultimate-pi setup providers` does**

1. Asks for the provider id, base URL, one or more model ids, and an optional API key.
2. Merges the endpoint into `<agentDir>/models.json` as `providers.<id>` with `baseUrl`, `api` (`openai-completions` unless you set another), and `models`. Existing providers in that file are kept. The API key is not written into `models.json`.
3. Stores the key in `auth.json` (mode `0600`). An empty key becomes the placeholder `local`, which Ollama ignores and which counts as configured so install does not demand `pi login` for that provider.
4. Offers those model ids when you assign agent roles.

`--answers` shape:

```json
{
  "id": "ollama",
  "authMethod": "api-key",
  "baseUrl": "http://127.0.0.1:11434/v1",
  "api": "openai-completions",
  "models": ["qwen2.5-coder:7b"],
  "credential": "local"
}
```

`model` (a string) is accepted instead of `models` and becomes a one-element list. You can declare more than one local endpoint by repeating the object with a different `id`.

## Other (`other`)

Any OpenAI-compatible provider: a provider id Pi already understands plus an API key.

**Prepare**

- The provider id (as Pi expects it) and an API key for that endpoint.

**Env var:** whatever that provider's own client reads (often `OPENAI_API_KEY` plus a base-URL setting). Ultimate Pi does not invent extra env names for `other`.

**What `ultimate-pi setup providers` does**

1. Prompts for a masked API key (`API key for other`).
2. Merges it into `auth.json` under the `other` id as `{ "type": "api_key", "key": "…" }`.
3. Does not prompt for a custom base URL; configure that in Pi's own provider settings if the endpoint is not the default.

## Tavily (`web_search`)

Not a model provider. The bundled `web_search` tool calls the [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search).

**Prepare**

- A Tavily API key (`tvly-…`) from https://app.tavily.com.

Key sources, in priority order:

1. `TAVILY_API_KEY` in the environment.
2. `<agentDir>/extensions/web-search/auth.json` with `tavily_api_key`. Copy `auth.example.json` and replace the placeholder locally; the package ships placeholders only. Never commit a real `auth.json`.

The installer offers an optional masked key prompt. `ultimate-pi setup web-search` writes the same extension-local file with mode `0600`.

Without this key, `web_search` errors with a missing-credentials message; `web_fetch` does not need it.

## Related

- [README.md](../README.md) — installer walkthrough and providers table
- [docs/jev.md](./jev.md) — OpenRouter + JEV
- [docs/architecture.md](./architecture.md) — how providers show up in routing and 429 fallback
- [docs/troubleshooting.md](./troubleshooting.md) — failed `/login`, missing keys, doctor output
- [SECURITY.md](../SECURITY.md) — never commit `auth.json`
