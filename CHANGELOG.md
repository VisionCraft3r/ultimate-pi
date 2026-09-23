# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
