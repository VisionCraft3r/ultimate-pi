# Extensions and skills

Ultimate Pi ships these extensions through `package.json` `pi.extensions`. Pi loads them in the main session. Child agents start with `--no-extensions`; a tool reaches a child only when that child's `tools:` frontmatter names it and the extension calls `registerToolExtension`.

Commands below are typed inside a Pi session.

## Routing and safety

### `jev-triage`

Classifies the user's exact wording into `tier_0` … `tier_4_qa`. Attaches the previous user turn for short continuations and skips re-triage of ship/continue crumbs. With an OpenRouter key it calls Jev; otherwise it uses a local keyword heuristic and says so.

Does not write code, invent file counts, or choose a model id.

### `jev-sentinel`

Safety and state check for `worker` and `qa_tester` before destructive bash. Registers itself so those children load it under `--no-extensions`, and that load also installs bash-guard's headless hard-block. If Jev is unavailable, a heuristic still blocks catastrophic commands.

### `quota-fallback`

On HTTP 429, switches the current turn to the next hop in `model-agents.json` (per-agent override, then per-provider chain, then a derived default from configured providers). When `settings.json` `enabledModels` or the session scoped-model list is non-empty, the derived default is skipped and a written hop is used only if that `provider/id` is in the list. The switch lasts for the session and does not rewrite the agent's saved model. If every hop 429s, the error is reported.

Does not embed a fixed list of model ids.

### `scout-budget`

Caps `scout` at 20 tool rounds. A round is one assistant message that contains tool calls. Round 20 still runs. Scout then gets one more turn to return the file and line map. A 21st round is blocked. The extension no-ops unless `PI_SUBAGENT_AGENT` is `scout`, so worker is unchanged. Install also passes `--no-lens-context` on the scout launch only: pi-lens stays loaded and its tools stay available, and its session-start and turn-end notes are not written into scout's prompt. Worker and planner do not get that flag.

### `model-agents`

`/ModelAgents` edits the five role models and the 429 chains, and rewrites only the agent table inside the `<!-- ultimate-pi:begin/end -->` block of `AGENTS.md`.

### `planner-handoff`

Gives the planner `handoff_spec` plus a silent-park `.ask` watchdog so a spec-ready plan becomes a `subagent_question` even if the planner only printed a park line. `handoff_spec` opens the spec in the Plannotator browser and waits for approval before writing the sidecar. `UNATTENDED_MODE=true` skips the browser. If Plannotator is not installed under the agent dir, the tool returns that error and does not send the handoff. The parent session reviews the question; the planner does not spawn workers itself.

### `bash-guard`

`/bash-guard` toggles the interactive Run/Abort prompt for risky shell commands in the main session. Subagents (`PI_SUBAGENT_DEPTH` ≥ 1) do not get that prompt: catastrophic patterns (`rm -r`, `sudo`, `curl|sh`, disk-wipe tools, and disguised one-liners) are hard-blocked. Disabling the interactive guard does not disable that floor.

Does not allow a child to work around a block.

`/jobs` wraps every bash command bash-guard allows. If that command still has background processes in the shell job table when it exits, each pid is written under `<agentDir>/jobs/<pid>/`. A process that detaches out of that job table is not recorded. A command bash-guard blocks is not wrapped. `/jobs` lists the live pids. `/jobs kill <pid>` stops that pid and its children, and only if the pid is in the ledger. With a UI, `/jobs kill` and no pid opens a picker. The ledger is shared. Worker can start jobs because it has bash. qa_tester loads this command through `jev_sentinel` and has no bash tool, so it can kill a job the worker started and cannot start one. The parent session can do both.

### `ask-user-question`

`ask_user_question` for free text, single-select, and multi-select with an always-present Other field. In a child session (`PI_SUBAGENT_SESSION`) it writes the question to the `.ask` sidecar and tells the child to stop and wait. The main session uses Pi's select and input dialogs. The option helpers live in `lib/question-helpers.ts`. Pi loads every top-level `extensions/*.ts` file as an extension, so a helper left there stops Pi from starting.

### `launch-update`

On session start, applies patch and minor npm updates that stay on known pins. Major bumps, and packages pinned to a patch (`@schultzp2020/pi-cursor`), are left in place. It also copies `extensions`, `lib`, `templates`, `skills`, and `patches` from a checkout named by `ULTIMATE_PI_ROOT` only after that checkout's tests pass. Extension files that do not export a factory are not copied. The extension does not assume a home-directory path.

## Browser, web, and prompts

### `browser`

`/browser on|off`. Tools: `browser_goto`, `browser_click`, `browser_eval`, `browser_fill`, `browser_screenshot`, `browser_console`, `browser_network`. Used by `qa_tester` for live pages. Chromium is not bundled; install it with `npx playwright-core install chromium`. The profile lives under the agent dir and is not part of this repository.

### `web-fetch`

`web_fetch` turns an HTTP response into markdown or plain text (HTML and PDF). Does not store credentials in the repo.

### `web-search`

`web_search` calls Google Custom Search. Keys come from the environment or from `<agentDir>/extensions/web-search/auth.json`. The package ships `auth.example.json` placeholders only.

### `prompt-snippets`

`/snippets` or alt+s toggles small prepend/append instructions for the next message: ask-questions, delegate-exploration, diagnose-report, orchestrator-mode, session-kickoff, verify-not-assume. Toggles reset after each send.

### Installed packages

`pi-context-view` is required and parent-only. `/context` inspects the prompt. It adds no model instructions. `@lucascardozo/pi-edit-guard` is required and is loaded only on child agents that already have `edit` or `write`.

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
