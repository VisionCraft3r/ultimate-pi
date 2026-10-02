# Extensions and skills

Ultimate Pi ships these extensions through `package.json` `pi.extensions`. Pi loads them in the main session. Child agents start with `--no-extensions`; a tool reaches a child only when that child's `tools:` frontmatter names it and the extension calls `registerToolExtension`.

Commands below are typed inside a Pi session.

## Routing and safety

### `jev-triage`

Classifies the user's exact wording into `tier_0` … `tier_5_review` and a `Verification:` of `tests`, `scout`, `browser`, or `reviewer`. Attaches the previous user turn for short continuations and skips re-triage of ship/continue crumbs. With an OpenRouter key it calls Jev; otherwise it uses a local keyword heuristic and says so. `tier_4_qa` and `tier_5_review` are composed from separate noul questions so "click" and "review" do not steal a bug or a plan. The verification choice is ignored unless the tier is an implementation tier, and a weak answer stays on `tests`.

Does not write code, invent file counts, or choose a model id. A live call aborts after `ULTIMATE_PI_JEV_TIMEOUT_MS` (default 8000) or when the tool is cancelled, and routing falls through to the heuristic with `JEV unavailable (timeout)`.

### `jev-sentinel`

Safety and state check for `worker` and `qa_tester` before destructive bash. Registers itself so those children load it under `--no-extensions`, and that load also installs bash-guard's headless hard-block. If Jev is unavailable, a heuristic still blocks catastrophic commands.

### `quota-fallback`

On a real quota signal — HTTP 429, rate-limit text, or the Anthropic extra-usage sentence — switches the current turn to the next hop in `model-agents.json` (per-agent override, then per-provider chain, then a derived default from configured providers). A Cursor connect `resource_exhausted` or "retries exhausted" is a dead proxy or a rejected model id, not an empty plan, and does not switch. When `settings.json` `enabledModels` or the session scoped-model list is non-empty, the derived default is skipped and a written hop is used only if that `provider/id` is in the list. The switch lasts for the session and does not rewrite the agent's saved model. If every hop 429s, the error is reported.

Does not embed a fixed list of model ids. After a session replacement the handler returns without reading the old context.

### `scout-budget`

Caps `scout` at 20 tool rounds. A round is one assistant message that contains tool calls. Round 20 still runs. Scout then gets one more turn to return the file and line map. A 21st round is blocked. The extension no-ops unless `PI_SUBAGENT_AGENT` is `scout`, so worker is unchanged. The scout launch does not load pi-lens and does not pass `--no-lens-context` (that flag only exists when pi-lens is loaded, and passing it makes the child exit immediately). Scout keeps `graft_find_code` and `graft_repo_map`. Worker and planner keep the full lists. A child's thinking level is a `--thinking` flag, not a suffix on the model id.

### `agent-config`

`/agents` lists every `agents/*.md` profile (managed roles and any extra profile such as `video-ads`; `*.ultimate-pi.md` sidecars are skipped) with its `model:` and `thinking:`. Pick one to change the model, the thinking level (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`), or both. `/agents list` prints the same table. `/agents <name> model <provider/id>` and `/agents <name> thinking <level>` skip the menus. Scoped models are listed first. A model missing from the registry, or a thinking level above `off` on a model that does not reason, is saved and called out. The write updates that profile and, when the name is in the managed table, the cell inside the `<!-- ultimate-pi:begin/end -->` block. It applies the next time that agent is spawned. A running pane is left alone. The command does nothing in a subagent session.

### `model-agents`

`/ModelAgents` edits 429 fallback chains (global per provider, and a per-agent override) and can rescan the Cursor catalog. The daily scan and "Scan now" talk to the local Cursor proxy only when `cursor-proxy.json` names a pid that is still running. A successful scan writes `cursor-model-cache.json` and names any managed `cursor/...` assignment that is not in that catalog. New ids are registered by pi-cursor on the next `/reload`. It rewrites only the agent table inside the `<!-- ultimate-pi:begin/end -->` block of `AGENTS.md` when it assigns one of the six managed roles. Use `/agents` to change what a role runs.

### `planner-handoff`

Gives the planner `handoff_spec` plus a silent-park `.ask` watchdog so a spec-ready plan becomes a `subagent_question` even if the planner only printed a park line. `handoff_spec` opens the spec in the Plannotator browser and waits for approval before writing the sidecar. `UNATTENDED_MODE=true` skips the browser. If Plannotator is not installed under the agent dir, the tool returns that error and does not send the handoff. The parent session reviews the question; the planner does not spawn workers itself.

### `bash-guard`

`/bash-guard` toggles the interactive Run/Abort prompt for risky shell commands in the main session. Subagents (`PI_SUBAGENT_DEPTH` ≥ 1) do not get that prompt: catastrophic patterns (`rm -r`, `sudo`, `curl|sh`, disk-wipe tools, and disguised one-liners) are hard-blocked. Disabling the interactive guard does not disable that floor.

Does not allow a child to work around a block. Three consecutive headless denials end the turn and tell the agent to return Status BLOCKED. An allowed command resets that count.

The floor lives in `extensions/bash-guard/rules.ts` with a justification, a safer alternative, and examples. Optional `<agentDir>/bash-rules.json` may add `forbidden` or `prompt` rules, or `allow` rules whose examples are not already on the floor. A malformed file keeps the built-ins. `ultimate-pi bash-check "<command>" [--agent worker]` prints the decision JSON. `--agent` uses the headless floor.

`/jobs` wraps every bash command bash-guard allows. If that command still has background processes in the shell job table when it exits, each pid is written under `<agentDir>/jobs/<pid>/`. A process that detaches out of that job table is not recorded. A command bash-guard blocks is not wrapped. `/jobs` lists the live pids. `/jobs kill <pid>` stops that pid and its children, and only if the pid is in the ledger. With a UI, `/jobs kill` and no pid opens a picker. The ledger is shared. Worker can start jobs because it has bash. qa_tester loads this command through `jev_sentinel` and has no bash tool, so it can kill a job the worker started and cannot start one. The parent session can do both.

### `ask-user-question`

`ask_user_question` for free text, single-select, and multi-select with an always-present Other field. In a child session (`PI_SUBAGENT_SESSION`) it writes the question to the `.ask` sidecar and tells the child to stop and wait. The main session uses Pi's select and input dialogs. The option helpers live in `lib/question-helpers.ts`. Pi loads every top-level `extensions/*.ts` file as an extension, so a helper left there stops Pi from starting.

### `launch-update`

On session start, after the prompt is up, applies patch and minor npm updates that stay on known pins. Version checks run four at a time. Installs stay one at a time. Major bumps, and packages pinned to a patch (`@schultzp2020/pi-cursor`), are left in place. It also copies `extensions`, `lib`, `templates`, `skills`, and `patches` from a checkout named by `ULTIMATE_PI_ROOT` only after that checkout's tests pass. Extension files that do not export a factory are not copied. The extension does not assume a home-directory path.

### `wave-diff`

Parent-only `wave_diff`. `action: "mark"` records HEAD and the dirty set under `.pi/wave-mark.json`. `action: "diff"` returns a capped `git diff --stat` plus changed and new files since that mark. The orchestrator passes that diff to the reviewer. A worker does not get this tool.

### `review-trace`

Parent-only. When a message contains a reviewer JSON verdict, and tracing is on, the verdict is appended to the local routing trace. The parser in `lib/review-verdict.ts` fails closed: unparsable output is `NEEDS CHANGES`.

### Routing trace

Set `ULTIMATE_PI_TRACE=1`, or `"ultimatePiTrace": true` in `<agentDir>/settings.json`. Events append to `<agentDir>/traces/<session>.jsonl`. Nothing is uploaded. Prompt-like fields are a hash and a length unless `ULTIMATE_PI_TRACE_CONTENT=1`. Values that look like tokens or keys are redacted either way. `skills/analyze-sessions/scripts/routing.py` summarizes tiers, triage source, fallback hops, bash blocks, and review repairs.

`web_fetch`, `browser_console`, and `browser_network` cap text that would otherwise enter the model. The full text is written beside the cap only when the current role has `read`. `researcher` and `qa_tester` see the truncation marker only. `browser_console` and `browser_network` already take `limit` and `filter`.

## Browser, web, and prompts

### `browser`

`/browser on|off`. Tools: `browser_goto`, `browser_click`, `browser_eval`, `browser_fill`, `browser_screenshot`, `browser_console`, `browser_network`. Used by `qa_tester` for live pages. Playwright loads on the first browser tool or `/browser on`, not at startup. Chromium is not bundled; install it with `npx playwright-core install chromium`. The profile lives under the agent dir and is not part of this repository.

### `web-fetch`

`web_fetch` turns an HTTP response into markdown or plain text (HTML and PDF). The HTML and PDF converters load on the first conversion, not at startup. Does not store credentials in the repo.

### `web-search`

`web_search` calls the Tavily Search API. The key comes from `TAVILY_API_KEY` or `<agentDir>/extensions/web-search/auth.json` (written by the installer prompt or `ultimate-pi setup web-search`). The package ships `auth.example.json` placeholders only.

### `prompt-snippets`

`/snippets` or alt+s toggles small prepend/append instructions for the next message: ask-questions, delegate-exploration, diagnose-report, orchestrator-mode, session-kickoff, verify-not-assume. Toggles reset after each send.

### Installed packages

`pi-context-view` is required and parent-only. `/context` inspects the prompt. It adds no model instructions. `@lucascardozo/pi-edit-guard` is required and is loaded only on child agents that already have `edit` or `write`.

### `session-chrome`

A two-line widget above the editor: a context bar (`ctx.getContextUsage()`, warning above 70%, error above 90%) and a one-line git dirty summary (branch, shortstat, untracked files). The parent and each subagent pane paint their own bar from that process. Children start with `--no-extensions`, so every profile lists the hidden tool `session_chrome` and this file re-injects itself with `registerToolExtension`. The model cannot call it. `/chrome` hides or shows the lines for that pane. `/chrome refresh` updates the git line. It does not replace Pi's footer.

### `custom-header`

Replaces Pi's startup banner with the Ultimate Pi logo. `/builtin-header` restores the stock header for the session. Every sandboxed child is launched with `-e` this file, so the pane shows the same header. It registers no tools.

## Skills

Skills survive `--no-extensions`. They are instructions plus local scripts, not model credentials.

| Skill | What it does | What it needs |
| --- | --- | --- |
| `analyze-sessions` | Cost rollups, prompt mining, and search over `~/.pi/agent/sessions` | Python 3 |
| `pdf-reader` | Text plus rendered pages for PDFs (equations, diagrams) | A local venv with PyMuPDF (`requirements.txt` in the skill) |
| `web-debug` | Playbooks that force `browser_*` for auth, CORS, storage, blank screens, and prod-only bugs | The browser extension and Chromium |
| `youtube-transcript` | Title and English captions as JSON | `yt-dlp` and Python 3 |
