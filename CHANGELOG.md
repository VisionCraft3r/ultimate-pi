# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`ultimate-pi setup web-search`.** Optional Tavily key prompt at install, stored at `<agentDir>/extensions/web-search/auth.json`.
- **Worker browser tools and session-audit hardening.** All seven `browser_*` tools in the worker profile, plus session-audit hardening rules in the managed routing block.

- **Session chrome.** A widget above the editor shows that pane's context bar (warning above 70%, error above 90%) and a one-line git dirty summary. `/chrome` hides or shows it for that pane. `/chrome refresh` updates the git line. The parent and each subagent paint their own bar. Children load it because every profile lists the hidden tool `session_chrome`. Pi's footer is unchanged. Extension files apply on `/reload`. Already installed profiles pick up `session_chrome` from `ultimate-pi setup agents`, or from the next spawn after that tool is on the profile.

- **JEV verification choice.** The same triage call now returns `Verification: tests | scout | browser | reviewer`. A worker wave no longer always gets a code reviewer. Tests are the default. A low-confidence verification answer stays on tests.

- **JEV deadline.** Live triage and sentinel calls abort after `ULTIMATE_PI_JEV_TIMEOUT_MS` (default 8s) or when the tool is cancelled, then fall through to the heuristic with a visible timeout or cancelled warning.
- **Shared tool-round budget.** Scout and qa_tester use one ceiling helper. `ULTIMATE_PI_WORKER_ROUND_NUDGE` (unset by default) asks a worker to wrap up after that many tool rounds and does not block tools.
- **Bash denial breaker.** Three consecutive headless bash-guard blocks end the turn. An allowed command resets the count.
- **Worker verify gate.** A worker that reports DONE without a backticked command under Verification gets one continuation steer.
- **Declarative bash floor.** Rules carry a justification, an alternative, and examples. Optional `bash-rules.json` can tighten, or relax prompt-level commands, and cannot override the floor. `ultimate-pi bash-check` prints the decision.
- **Reviewer JSON verdict.** Unparsable reviewer output counts as NEEDS CHANGES. `wave_diff` marks the worktree and returns the wave diff for the reviewer.
- **Context cap.** The managed routing block has a byte budget checked by `npm run scan`. Oversized web and browser output is truncated, and spilled to a file only for roles that can read.
- **Profile lint and schemas.** Doctor checks managed agent profiles. `schemas/answers.schema.json` and `schemas/model-agents.schema.json` describe the installer answers file and fallback file.
- **Opt-in routing trace.** `ULTIMATE_PI_TRACE=1` writes a local JSONL under the agent directory. It is not uploaded. `routing.py` summarizes it.

Extension changes apply on `/reload`. The managed routing block and agent profiles update through `ultimate-pi setup agents`, not from a package update alone.

### Changed

- **`web_search` uses Tavily.** Set `TAVILY_API_KEY`; the old Google environment variables are no longer read. Requests use bearer-authenticated POST, structured domain filters, bounded result counts, and explicit authentication/rate/usage-limit messages. The secret scanner recognizes Tavily keys.
- **Pi peer compatibility.** The four `@earendil-works/pi-*` peer dependencies now require `^1.0.0`; the lockfile is refreshed accordingly.
- **Local graph caches.** `.gitignore` excludes the regenerable `graft/` graph from commits; `.ignore` keeps its cards searchable while excluding graph/cache internals. The managed routing context budget is 17,408 bytes after session-audit hardening.

### Fixed

- **Replaced-session contexts.** Pinned, hash-checked patches protect Cursor 0.5.2, graft 0.1.2, and interactive-subagents 3.7.2 from stale context calls. See [patches/README.md](./patches/README.md) for targets, patch order, and image hashes.
- **Safe launch updates.** Checkout synchronization and package updates defer while subagents run; launch retries deferred checks up to four times at one-minute intervals. The Plannotator fresh-idle-session persistence guard is restored when its known source marker matches, with a warning if it does not.
- **Sandboxed child display.** Children load the custom header without expanding their tool grants. Legacy combined stdout/stderr log redirects become stderr-only so the pane keeps its display, and launchers calling the viewer regain a missing viewer import.
- **Quota continuation.** Short assistant-text `resource_exhausted` errors and the extra-usage-limit response trigger fallback, with a hold flag until continuation is scheduled. Temporary localhost debug-ingest requests have been removed; normal tracing remains opt-in.

### Performance and routing

- **Faster launch.** Playwright loads on the first browser tool or `/browser on`. HTML and PDF converters load on the first conversion. The Cursor catalog scan no longer makes startup wait; `/ModelAgents` "Scan now" still waits. The checkout hash and npm version checks run on the next turn, and `npm view` runs four at a time. Installs stay one at a time.

  `npm run measure:startup` (median of 5, each extension in a fresh process, network stubbed): browser 322.6 ms to 108.5 ms, web fetch 179.4 ms to 111.7 ms, launch-update session start 6.9 ms to 0.1 ms, model-agents session start 2.4 ms to 0.7 ms and it no longer returns a promise. Sum of those medians 2670.9 ms to 2468.2 ms. A real Pi launch reached the header in 1.720 s, 1.714 s, and 1.711 s before this copy (median 1.714 s), and in 1.722 s, 1.529 s, and 1.485 s after (median 1.529 s).

- **`reviewer` role.** Read-only sixth agent with its own model assignment. `tier_1`, `tier_2`, and `tier_3` keep their current first role, then one reviewer covers the worker wave. `tier_5_review` is a JEV noul for a code audit, project audit, security review, or PR/diff review and starts with the reviewer. Blocking findings on an implementation tier repair for up to two rounds. An audit that only asks for findings stops at the report. Existing installs get `agents/reviewer.md` from `ultimate-pi setup agents` or a new install, not from a package update alone. An answers file that omits `reviewer` copies the planner assignment into a separate entry.

## [1.2.0-alpha] — 2026-10-01

Checked on Pi 0.99.2. That release does not change extension commands or flag parsing: a flag registered by an extension that is not loaded is still an unknown option, and the process exits before the child starts.

### Added

- **`/agents`.** Lists every profile in `agents/*.md` with its model and thinking level, including profiles the installer does not manage. Change either field from the menu, or with `/agents <name> model <provider/id>` and `/agents <name> thinking <level>`. The new values apply the next time that agent is spawned.

### Fixed

- **Scout launch.** Scout no longer receives `--no-lens-context`. That flag is registered by pi-lens, which scout does not load, so Pi exited with "Unknown option" before the child wrote a session. An already patched launcher drops the flag on the next Ultimate PI update. pi-lens stays off scout. Scout still keeps `graft_find_code` and `graft_repo_map`.

## [1.1.0-alpha] — 2026-09-28

### Added

- **Routing manual** in the managed `AGENTS.md` block: continuation crumbs, tier rules, a cap of 3 concurrent implementation panes, `subagent_question` handling, cache discipline, and the grantable tool list. Model ids stay in the parameterized agent table.
- **Preference defaults** applied only when unset: `neon-noir` theme, visible thinking, compaction, and graft hit/char limits. Observational memory starts enabled when it is installed. `npm:@spences10/pi-themes` is now required.
- **macOS completion beep** is the default extra on darwin (`--yes` and the preselected prompt). The snippet is appended outside the managed markers and is not duplicated. iTerm2 status stays opt-in.
- Docs: [docs/extensions.md](./docs/extensions.md) and [docs/improvements.md](./docs/improvements.md)
- **Local model** provider choice: base URL, model ids, and an optional API key are written to `models.json` plus `auth.json` during install and `setup providers`. The model ids are offered when assigning agents. `--yes` does not invent a local server.
- **Scoped 429 fallback.** When `enabledModels` or the session's scoped model list is non-empty, a quota switch uses only hops written in `model-agents.json` that are also in that list. An empty list still uses the derived default chain.
- **Plannotator on `handoff_spec`.** The planner opens the spec in the browser and waits for approval before the `.ask` sidecar is written. `UNATTENDED_MODE=true` skips the browser. A missing Plannotator install returns the reason instead of pretending the spec was sent.
- **`ask_user_question` in child sessions** parks the question in the `.ask` sidecar and tells the child to wait. Option helpers live in `lib/`, not `extensions/`, so Pi does not try to load them as extensions.
- **`launch-update`** on session start applies patch and minor npm updates that stay on known pins, and copies a newer checkout into the agent dir only after that checkout's tests pass. Point it at a checkout with `ULTIMATE_PI_ROOT`. Major bumps stay put.
- **`qa_tester`** profile sets `thinking: medium`.
- **`/jobs`** records background processes left by bash commands bash-guard allows, under `<agentDir>/jobs`. `/jobs` lists them. `/jobs kill <pid>` stops a recorded pid and its children. Worker can start them. qa_tester can kill them and cannot start them. The parent session can do both.
- **Scout tool-round ceiling.** Scout stops after 20 tool rounds (one assistant message that contains tool calls). Round 20 still runs, then scout has one chance to return the file and line map. A 21st round is blocked. Worker is unchanged.
- **Scout `--no-lens-context`.** pi-lens is not attached to scout. Scout keeps `graft_find_code` and `graft_repo_map`. Worker and planner keep the full lists. Session-start and turn-end notes are not written into scout's prompt.
- **Child thinking flag.** Subagents pass `--thinking` separately. The level is not glued onto the model id.
- **QA tool-round ceiling.** `qa_tester` stops after 20 tool rounds and must return pass or fail and the failing step.
- **`.pi/invariants.md`.** The planner reads it when it exists. Planner and worker append one line only for a repo-wide rule the next story would get wrong.
- **BMAD project choice** is a separate package, `git:github.com/VisionCraft3r/ultimate-pi-bmad`. It is not part of a default install. Install asks on its own, the default is no, and `--yes` does not select it. `answers.packages` can name the spec. `ultimate-pi setup packages` can add it later. When installed, a v6 tree (`_bmad` plus `.agents/skills/bmad-agent-*`) asks once: BMAD agents, or Ultimate PI agents. The answer is `{project}/.pi/agent-system`. Ultimate PI mode folds persona principles into the existing roles and still routes with `jev_triage`. A planner brief gets one planning persona. A story under `implementation_artifacts` that already names files skips scout. BMAD mode loads `.agents/skills` and does not remap that work onto the five roles. An older v6 install can run `bmad-method` quick-update; `_bmad/custom/` is hashed before and after. A decline is remembered per latest version. A non-v6 tree is not migrated.
- **`pi-context-view`** is required. Parent-only `/context`. It adds no model instructions.
- **`@lucascardozo/pi-edit-guard`** is required and loads only on child agents that already have `edit` or `write`.

### Removed

- **BMAD bridge from this package.** `extensions/bmad-bridge.ts` and its helpers are no longer shipped with Ultimate PI. They live in `ultimate-pi-bmad` and are installed only when chosen.
- **`video-ads` role.** Install no longer writes that profile or routes video-ad work to it. An existing local `agents/video-ads.md` is left in place.

### Security

- Install does not copy agent model lists, API keys, `auth.json`, graft filesystem roots, sessions, or trust files from any maintainer machine.

## [1.0.0-alpha] — 2026-09-23

First public-release-candidate build, driven by a pre-release stress test (installer, provider/model assumptions, bash-guard safety, and uninstall completeness). Tagged `-alpha` per [SemVer](https://semver.org/spec/v2.0.0.html#spec-item-9): public API/CLI surface may still change before `1.0.0`.

### Fixed

- **Installer preflight** now prints an OS-specific fix command for each missing prerequisite (Node version, `pi` on PATH, `tmux`) instead of one generic failure message
- **`--yes` non-interactive install** now checks provider auth readiness before applying settings/packages, and exits early with the exact `pi login` command needed — previously it could apply partial state and then fail doctor with an empty `auth.json`
- **Doctor** empty-auth guidance now points directly at `pi login`
- **`--answers` schema** unified on canonical `agentAssignments` / top-level `providerChains` keys (with aliases for older-shaped files), fixing a bug where a correctly-documented answers file was silently ignored in favor of catalog defaults
- **`--yes` role assignment** now prefers a model from a provider actually selected/authenticated in the run, instead of always assigning all five agent roles to the first catalog entry
- **Answers template and `docs/architecture.md` examples** now use real, currently-cataloged model IDs instead of stale/nonexistent placeholders that would 404
- **bash-guard**: subagents may now run `git commit`/`git add` (still blocked: `git push`, `git pull`); interactive analyzer now catches disguised destructive commands via `python -c` / `perl -e` / `ruby -e` / `node -e` / `xargs rm`, and no longer over-flags routine `git` subcommands or read-only `lsblk`
- **Optional git-based package installs** now preflight-check for `git` availability with a clear error instead of a raw failure
- **`uninstall --full` / `--purge`** flag added to also remove `model-agents.json` and Ultimate Pi's third-party packages (never touches `auth.json`); default uninstall behavior is unchanged
- **Docs**: README now documents the separate Chromium install step required for browser/QA tools (`npx playwright-core install chromium`); `docs/troubleshooting.md`'s description of `setup extras` corrected to macOS-only conveniences
- **`scan-personal`** now also flags generic `/Users/<name>/` and `/home/<name>/` paths, not just a fixed name denylist

## [0.1.0] — 2026-09-23

### Added

- JEV tiered routing (`tier_0` through `tier_4_qa`) with configurable thresholds and heuristic fallback
- Five-role subagent team (scout, worker, planner, researcher, qa_tester) in tmux panes
- Tool allowlisting per agent role
- Cross-provider 429 fallback, including per-agent overrides
- Planner spec handoff into the worker path
- bash-guard catastrophic-floor fix
- Browser QA tools
- Web fetch and web search
- Prompt snippets
- Optional integrations for pi-observational-memory, pi-lens, pi-cache-graph, and pi-graft
- Interactive installer plus `--answers` / `--yes` non-interactive modes
- `doctor` self-check for the installed layout
