# NOTICE

This file lists third-party software, models, and services that Ultimate Pi uses or documents. Ultimate Pi itself is MIT-licensed (see `LICENSE`). Third-party works remain under their own licenses and terms.

**Ultimate Pi is not affiliated with Anthropic, OpenAI, Cursor, OpenRouter, DeepSeek, or TypeSafe AI.**

The wording below is a factual credit list compiled from public sources. It is not legal advice and is not an officially required or approved attribution formula from any named vendor.

---

## Host: Pi

[Pi](https://github.com/badlogic/pi-mono) by Mario Zechner / [earendil-works](https://github.com/earendil-works/pi), MIT.

Peer packages (not vendored in this repository):

- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-tui`
- plus the host `typebox` peer

These remain `peerDependencies`. This package does not vendor them.

---

## Community Pi extensions (inspiration / optional install)

- pi-interactive-subagents — original by HazAT ([MIT](https://github.com/HazAT/pi-interactive-subagents/blob/main/LICENSE)); tmux-only derivative maintained by Amos Blomqvist ([source](https://github.com/amosblomqvist/pi-interactive-subagents), [MIT license retaining © 2026 HazAT](https://github.com/amosblomqvist/pi-interactive-subagents/blob/main/LICENSE)).
- [pi-observational-memory](https://github.com/amosblomqvist/pi-observational-memory) — Amos Blomqvist, MIT.
- [@gotgenes/pi-anthropic-auth](https://www.npmjs.com/package/@gotgenes/pi-anthropic-auth) — Chris Lasher, MIT.
- [@schultzp2020/pi-cursor](https://www.npmjs.com/package/@schultzp2020/pi-cursor) — Paul Schultz, MIT.
- [@plannotator/pi-extension](https://www.npmjs.com/package/@plannotator/pi-extension) — backnotprop, MIT OR Apache-2.0.
- [pi-lens](https://www.npmjs.com/package/pi-lens) — Apostolos Mantzaris, MIT.
- [pi-cache-graph](https://www.npmjs.com/package/pi-cache-graph) — Arnav Gupta, MIT.
- [pi-graft](https://www.npmjs.com/package/pi-graft) — KSonny4, MIT.

---

## Jev (TypeSafe AI) and OpenRouter

Jev is a proprietary System One decision model by [TypeSafe AI](https://typesafe.ai/), accessed via [OpenRouter](https://openrouter.ai/). Jev itself and its model weights are not included in Ultimate Pi and are not licensed under Ultimate Pi's MIT license.

Ultimate Pi is not affiliated with TypeSafe AI or OpenRouter.

- Optional client only: Ultimate Pi may call OpenRouter's documented alpha Decisions API (`POST https://openrouter.ai/api/alpha/decisions`) with model id `typesafe/jev-1.13` when the user configures an OpenRouter API key. This package does **not** bundle Jev weights, credentials, or a TypeSafe account.
- Terms (user's own accounts apply): [OpenRouter Terms of Service](https://openrouter.ai/terms) and [TypeSafe AI Terms of Use](https://typesafe.ai/terms). TypeSafe's linked terms page governs its website and defers product/service usage to any separate agreement; this NOTICE does not claim that page is a complete Jev model API license.
- Docs: [TypeSafe AI](https://typesafe.ai/), [TypeSafe docs](https://docs.typesafe.ai/), [OpenRouter Jev hub](https://openrouter.ai/docs/guides/community/jev).

---

## Other external model providers

Ultimate Pi's installer can help configure **user-supplied** credentials for third-party model providers. Those providers and models are **not** part of this MIT-licensed package.

- [OpenRouter](https://openrouter.ai/) — optional routing / Decisions API gateway. User's OpenRouter account and [terms](https://openrouter.ai/terms) apply.
- [DeepSeek](https://www.deepseek.com/) — optional provider choice in the installer catalog. User's DeepSeek account and terms apply.
- Other catalog entries (Anthropic, OpenAI / Codex, Cursor, generic OpenAI-compatible, other) are likewise external services. Ultimate Pi is not affiliated with them.

---

## Provenance-unverified local implementations

`extensions/web-fetch/`, `extensions/web-search/`, and `extensions/ask-user-question.ts` are **provenance-unverified, clean-room implementations by the Ultimate Pi project**. They are **not** verbatim ports of any identified upstream.

No clearly identifiable upstream original or transferable file-level license was established for these three (see `.pi/research/ultimate-pi-attribution-20260923.md` §5). Nearby community packages that share a tool *name* are **not** this code's origin and must not be credited as copied-code authors.

### `extensions/web-fetch/index.ts`

Local/custom. Nearby packages (`@tylerho/pi-web-fetch`, `@m4ss/pi-web-fetch`) share the tool name but not this Readability + linkedom + turndown + unpdf + Jina implementation. Credit the **runtime libraries**, not those unrelated packages:

- `@mozilla/readability` (Apache-2.0)
- `linkedom` (MIT)
- `turndown` (MIT)
- `unpdf` (MIT)
- Jina Reader (`https://r.jina.ai/`) is an optional remote fallback, not a vendored work

User-Agent is the generic `Mozilla/5.0 (compatible; ultimate-pi/0.1.0)` (not OS-specific).

### `extensions/web-search/`

Local/custom. Google Custom Search wrapper with env aliases `GOOGLE_SEARCH_API_KEY` | `GOOGLE_API_KEY` and `GOOGLE_CSE_ID` | `GOOGLE_CUSTOM_SEARCH_ENGINE_ID`. Ships `auth.example.json` **placeholders only**. Do not copy a real `auth.json`. File-based credentials, if used, live under the agent dir (`<agentDir>/extensions/web-search/auth.json`).

### `extensions/ask-user-question.ts`

Local/custom. Pi examples `question.ts` / `questionnaire.ts` are API references, not a demonstrated verbatim origin. Community packages that share the `ask_user_question` tool name (`@juicesharp/rpiv-ask-user-question`, `@tylerho/pi-ask-user-question`, `@josephyoung/pi-ask-user-question`) were **not** established as this file's source. Local TUI behavior: free-text, single-select, multi-select, and an always-present **Other** custom input, using `@earendil-works/pi-tui` primitives.

---

## Other local extensions and extras

File-level copyright/license headers were **not** present on the local sources copied into this package for the items below. No identical upstream file was identified in the public Pi examples tree (`earendil-works/pi`) or as a verified copy of a named community package. **Do not add a fabricated attribution header** on these files.

### `extensions/bash-guard/`

Local Pi extension (tool-call interceptor for `bash`). Runtime library: [`shell-quote`](https://www.npmjs.com/package/shell-quote) (MIT). No separate identifiable upstream for the guard logic itself. Behavior note: when the main-session guard is disabled, the `MAIN_DISABLED_BLOCKED` catastrophic floor is still applied (fix vs. the original early `return`).

### `extensions/browser/`

Local Pi extension (`browser_*` tools, default off). Runtime library: [`playwright-core`](https://www.npmjs.com/package/playwright-core) (Apache-2.0). Persistent profile directory is `<agentDir>/extensions/browser/.profile` (`PI_CODING_AGENT_DIR` or `~/.pi/agent`), overridable with `PI_BROWSER_PROFILE`. Chromium is not bundled; install separately with `npx playwright-core install chromium`.

### `extras/macos/iterm2-status.ts`

Opt-in macOS extra, genericized from a local iTerm2 status helper. Binary path: `ULTIMATE_PI_ITERM_STATUS_BIN`, else `~/.config/iterm2/cc-status`. Silent no-op if the binary is absent or `TERM_SESSION_ID` is unset. Not registered in `package.json` `pi.extensions` (installer adds a local path entry only when the user opts in).

### `extras/macos/completion-beep.md`

Opt-in AGENTS.md snippet documenting `afplay /System/Library/Sounds/Ping.aiff`. macOS-only; not part of the default extension set.

---

## npm runtime dependencies

Direct runtime libraries declared in this package, with the license used by each project as published on npm / in their own `package.json` (Apache-2.0 noted where the draft already verified it; others listed as MIT):

| Package | License |
| --- | --- |
| `@clack/prompts` | MIT |
| `shell-quote` | MIT |
| `playwright-core` | Apache-2.0 |
| `@mozilla/readability` | Apache-2.0 |
| `linkedom` | MIT |
| `turndown` | MIT |
| `unpdf` | MIT |

Each dependency remains under its own license. See that package's `LICENSE` / `NOTICE` for full terms.
