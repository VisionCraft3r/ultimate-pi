# Extensions and skills

Ultimate Pi ships these extensions through `package.json` `pi.extensions`. Pi loads them in the main session. Child agents start with `--no-extensions`; a tool reaches a child only when that child's `tools:` frontmatter names it and the extension calls `registerToolExtension`.

Commands below are typed inside a Pi session.

## Routing and safety

### `jev-triage`

Classifies the user's exact wording into `tier_0` … `tier_4_qa`. Attaches the previous user turn for short continuations and skips re-triage of ship/continue crumbs. With an OpenRouter key it calls Jev; otherwise it uses a local keyword heuristic and says so.

Does not write code, invent file counts, or choose a model id.

### `jev-sentinel`

Safety and state check for `worker`, `qa_tester`, and `video-ads` before destructive bash. Registers itself so those children load it under `--no-extensions`, and that load also installs bash-guard's headless hard-block. If Jev is unavailable, a heuristic still blocks catastrophic commands.

### `quota-fallback`

On HTTP 429, switches the current turn to the next hop in `model-agents.json` (per-agent override, then per-provider chain, then a derived default from configured providers). The switch lasts for the session and does not rewrite the agent's saved model. If every hop 429s, the error is reported.

Does not embed a fixed list of model ids.

### `model-agents`

`/ModelAgents` edits the six role models and the 429 chains, and rewrites only the agent table inside the `<!-- ultimate-pi:begin/end -->` block of `AGENTS.md`.

### `planner-handoff`

Gives the planner `handoff_spec` plus a silent-park `.ask` watchdog so a spec-ready plan becomes a `subagent_question` even if the planner only printed a park line. The parent session reviews that question; the planner does not spawn workers itself.

### `bash-guard`

`/bash-guard` toggles the interactive Run/Abort prompt for risky shell commands in the main session. Subagents (`PI_SUBAGENT_DEPTH` ≥ 1) do not get that prompt: catastrophic patterns (`rm -r`, `sudo`, `curl|sh`, disk-wipe tools, and disguised one-liners) are hard-blocked. Disabling the interactive guard does not disable that floor.

Does not allow a child to work around a block.

### `ask-user-question`

`ask_user_question` for free text, single-select, and multi-select with an always-present Other field. Forwards questions to the Paperclip sidecar when that environment is set, and parks subagents until the parent answers.

### `paperclip-mirror`

When Paperclip env is set, mirrors tmux subagent launches and closes as board child tasks.

### `paperclip-subagent-hold`

Holds a `--print` run open until spawned subagents finish, so a Paperclip job does not exit while panes are still working.

### `launch-update`

On session start, checks whether a local Ultimate Pi checkout is newer than the installed tree and copies `extensions`, `lib`, `templates`, `skills`, and `patches` only after that checkout's tests pass. Override the checkout with `ULTIMATE_PI_ROOT`.

## Browser, web, and prompts

### `browser`

`/browser on|off`. Tools: `browser_goto`, `browser_click`, `browser_eval`, `browser_fill`, `browser_screenshot`, `browser_console`, `browser_network`. Used by `qa_tester` and `video-ads` for live pages. Chromium is not bundled; install it with `npx playwright-core install chromium`. The profile lives under the agent dir and is not part of this repository.

### `web-fetch`

`web_fetch` turns an HTTP response into markdown or plain text (HTML and PDF). Does not store credentials in the repo.

### `web-search`

`web_search` calls Google Custom Search. Keys come from the environment or from `<agentDir>/extensions/web-search/auth.json`. The package ships `auth.example.json` placeholders only.

### `prompt-snippets`

`/snippets` or alt+s toggles small prepend/append instructions for the next message: ask-questions, delegate-exploration, diagnose-report, orchestrator-mode, session-kickoff, verify-not-assume. Toggles reset after each send.

### `custom-header`

Replaces Pi's startup banner with the Ultimate Pi logo. `/builtin-header` restores the stock header for the session.

## Skills

Skills survive `--no-extensions`. They are instructions plus local scripts, not model credentials.

| Skill | What it does | What it needs |
| --- | --- | --- |
| `analyze-sessions` | Cost rollups, prompt mining, and search over `~/.pi/agent/sessions` | Python 3 |
| `pdf-reader` | Text plus rendered pages for PDFs (equations, diagrams) | A local venv with PyMuPDF (`requirements.txt` in the skill) |
| `web-debug` | Playbooks that force `browser_*` for auth, CORS, storage, blank screens, and prod-only bugs | The browser extension and Chromium |
| `youtube-transcript` | Title and English captions as JSON | `yt-dlp` and Python 3 |

`video-ads` also expects the external HyperFrames skills (`hyperframes`, `hyperframes-core`, `media-use`, and the other `hyperframes-*` skills) on Pi's normal skill path. Those files are not vendored here. If they are missing, the agent must say so and stop.
