# Troubleshooting

Run the self-check first:

```bash
ultimate-pi doctor
```

It prints ✔/✖ lines for Node.js (>= 22.19), `tmux`, `pi` on `PATH` (skipped with `--offline`), provider entries in `<agentDir>/auth.json`, `pi-interactive-subagents` in `settings.json`, and whether `model-agents.json` fallbacks reference providers that have credentials. The last line is `doctor` itself.

Agent directory is `--agent-dir`, else `PI_CODING_AGENT_DIR`, else `~/.pi/agent`.

Re-run any installer step without a full reinstall:

```bash
ultimate-pi setup providers
ultimate-pi setup agents
ultimate-pi setup fallbacks
ultimate-pi setup jev
ultimate-pi setup memory
ultimate-pi setup extras
```

`--yes` accepts defaults, `--dry-run` prints without writing, `--answers <file.json>` is fully scripted.

## `pi` is not on PATH

**Symptom:** preflight / doctor shows `✖ pi binary on PATH — not found`. Install and `ultimate-pi` both expect a `pi` executable on `PATH`.

**Fix**

1. Install the [Pi coding agent](https://pi.dev) for your platform.
2. Confirm the binary:

   ```bash
   which pi
   pi --help
   ```

3. If it only works inside a specific shell init file, open a new terminal (or add that directory to `PATH`) and re-run `ultimate-pi doctor`.

`--offline` skips the `pi --help` probe and marks the check skipped, so it will not catch a missing binary.

## `tmux` is missing (subagents will not spawn)

**Symptom:** `✖ tmux present — required by pi-interactive-subagents`. Scout/worker/planner/researcher/qa_tester each need their own tmux pane. Without `tmux`, the five-role team cannot launch (Windows needs WSL; native Windows is not supported).

**Fix**

- macOS: `brew install tmux`
- Debian/Ubuntu: `sudo apt install tmux`
- then `which tmux` and re-run doctor

Doctor also checks that `settings.json` lists `pi-interactive-subagents`. If tmux is fine but that package is missing: `✖ pi-interactive-subagents installed — missing — subagent spawning will not work`. Re-run `ultimate-pi install` (or restore the package entry) so the orchestrator can actually spawn panes.

## Doctor says a provider has no credentials

**Symptom:** `✖ provider auth — no providers configured — run \`ultimate-pi setup providers\`` or `✖ fallback config — references provider(s) with no credentials: <id>`.

`auth.json` is the source of truth doctor uses. Empty file / missing keys means the installer never merged an API key and Pi never wrote an OAuth entry.

**Fix**

1. `ultimate-pi setup providers` and complete the OAuth `/login` or masked key prompt for that id.
2. For API-key providers, confirm `<agentDir>/auth.json` has `"<id>": { "type": "api_key", "key": "…" }` (mode `0600`). Do not paste keys into chat or commit that file.
3. For OAuth (`anthropic`, `openai-codex`, `cursor`), the installer does not write the token — Pi's `/login` does. If `auth.json` still has no entry, `/login` did not finish.
4. If fallbacks name a provider you never configured, either add that provider or re-run `ultimate-pi setup fallbacks` so the chain only points at ids you have.

Env-only keys (`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, …) work at runtime for Pi/JEV but **doctor only reads `auth.json`**, so a working env-only setup can still look empty. That is expected; add the provider via setup if you want doctor to see it.

## JEV falls back to heuristic mode unexpectedly

**Symptom:** every triage line starts with `⚠ JEV not configured — heuristic routing (run \`ultimate-pi setup jev\`).` or `⚠ JEV unavailable (…)`. Confidence is capped at 60.

Live JEV needs an OpenRouter key. Resolution order (`lib/openrouter-auth.ts`): `OPENROUTER_API_KEY` (wins if set) else `<agentDir>/auth.json` → `openrouter.key`.

**Fix**

1. `ultimate-pi setup jev` (or include `openrouter` in `ultimate-pi setup providers`) and paste a real key. Skipping that step is what heuristic mode is *for*.
2. Confirm the key is in `auth.json` under `openrouter`, or exported as `OPENROUTER_API_KEY` in the same shell that launches `pi`.
3. If the warning is `⚠ JEV unavailable (network error: API returned HTTP …)` the key was found but the Decisions API rejected the call (401/402/404/5xx, no credits, or the model id is unavailable). Check OpenRouter billing and that `ULTIMATE_PI_JEV_MODEL` (default `typesafe/jev-1.13`) is a model your key can call.
4. `⚠ JEV unavailable (malformed API response)` means HTTP was OK but the body had no `task_tier` choice — usually a transient API change; retry, then file a bug with the status/body *redacted*.
5. Custom `ULTIMATE_PI_JEV_ENDPOINT` pointing at the wrong URL will also fail closed into the heuristic.

See [docs/jev.md](./jev.md).

## Stuck OAuth `/login`

**Symptom:** `ultimate-pi setup providers` is waiting on "confirm after `/login` succeeded", or Pi's `/login` browser flow never returns.

OAuth for `anthropic`, `openai-codex`, and `cursor` is **Pi's** interactive login, not Ultimate Pi's. The installer only prints:

1. In another terminal, run `pi`
2. At the Pi prompt, run `/login`
3. Complete that provider's flow, then confirm back in the installer

**Fix**

- Use a **second** terminal for `pi` / `/login`. Do not Ctrl-C the installer while the browser is open unless you intend to abort.
- `cursor` needs `@schultzp2020/pi-cursor` installed **before** `/login` can see Cursor. If you confirmed too early, finish install/apply, then run `pi` → `/login` again, or `ultimate-pi setup providers`.
- `anthropic` OAuth uses `@gotgenes/pi-anthropic-auth` (installed on apply when Anthropic is selected). Same retry: apply first, then `/login`.
- `openai-codex` is ChatGPT OAuth, not `OPENAI_API_KEY`. A platform API key will not unblock Codex `/login`.
- Browser never opens: check that `pi` is the one on `PATH` (`ultimate-pi doctor`), then retry `/login`. If it still hangs, cancel the installer confirm (or abort) and run `/login` from a standalone `pi` session until `auth.json` gains that provider.
- `--yes` selects the three OAuth providers **without** waiting for `/login`. You still have to `/login` yourself before those providers work.

## Fallback chain is empty for an agent

**Symptom:** 429s fail the session with no failover; doctor may still pass if `model-agents.json` is missing (it reports "defaults will be used") or if chains parse but a given agent has no override.

Resolution order on a 429 ([docs/architecture.md](./architecture.md)):

1. `agentFallbacks[<agent>]` (`main` for the orchestrator)
2. `fallbacks[<provider>]` for the provider that just 429'd
3. a derived default across configured providers
4. none — logged once, error surfaces

An empty-looking chain usually means setup fallbacks was skipped, `--yes` left defaults you did not notice, or the per-agent override is `[]`.

**Fix**

1. `ultimate-pi setup fallbacks` and set global per-provider chains, then optional per-agent overrides.
2. Inspect `<agentDir>/model-agents.json` for `fallbacks` and `agentFallbacks`. In-session, `/ModelAgents` edits the same file.
3. If doctor says fallbacks reference a provider with no credentials, add that provider or remove it from the chain — a fallback id with no auth is not a fallback.
4. One configured provider and no chain ⇒ there is nowhere to fail over. Add a second provider, then re-run fallbacks.

## Re-running installer steps

| Command | What it does |
|---|---|
| `ultimate-pi install` | Full walkthrough (preflight → providers → agents → fallbacks → JEV → memory → extras → apply → doctor) |
| `ultimate-pi setup providers` | Select providers and capture OAuth/keys |
| `ultimate-pi setup agents` | Assign models to scout/worker/planner/researcher/qa_tester |
| `ultimate-pi setup fallbacks` | Per-provider 429 chains and per-agent overrides |
| `ultimate-pi setup jev` | OpenRouter key for live JEV (else heuristic) |
| `ultimate-pi setup memory` | Optional DeepSeek key / observational memory |
| `ultimate-pi setup extras` | Optional packages and macOS extras |
| `ultimate-pi doctor` | Self-check only |
| `ultimate-pi uninstall` | Removes Ultimate Pi package wiring; does **not** delete `auth.json` |

Writes to existing files take a timestamped backup first. API keys are never printed.

## Related

- [docs/providers.md](./providers.md) — per-provider login
- [docs/jev.md](./jev.md) — live vs heuristic JEV
- [docs/architecture.md](./architecture.md) — 429 resolution and allowlists
- [SECURITY.md](../SECURITY.md) — do not commit `auth.json` or paste keys into issues
