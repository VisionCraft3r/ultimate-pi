# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- **BMAD project choice.** A v6 tree (`_bmad` plus `.agents/skills/bmad-agent-*`) asks once: BMAD agents, or Ultimate PI agents. The answer is `{project}/.pi/agent-system`. Ultimate PI mode folds persona principles into the existing roles and still routes with `jev_triage`. A planner brief gets one planning persona. A story under `implementation_artifacts` that already names files skips scout. BMAD mode loads `.agents/skills` and does not remap that work onto the five roles. An older v6 install can run `bmad-method` quick-update; `_bmad/custom/` is hashed before and after. A decline is remembered per latest version. A non-v6 tree is not migrated.
- **`pi-context-view`** is required. Parent-only `/context`. It adds no model instructions.
- **`@lucascardozo/pi-edit-guard`** is required and loads only on child agents that already have `edit` or `write`.

### Removed

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
