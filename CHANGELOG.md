# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
