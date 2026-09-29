# What a fresh install matches

A new `ultimate-pi install` follows the same operating rules as the maintainer's Pi session: graft and pi-lens before broad reads, JEV tiers, a cap of three concurrent implementation panes, checkpointed milestones, and cache discipline. Model ids stay yours.

This page is the delta that used to live only in one local agent directory. Extensions and skills are listed in [extensions.md](./extensions.md).

## Routing manual

`templates/AGENTS.md.tmpl` is spliced between `<!-- ultimate-pi:begin -->` and `<!-- ultimate-pi:end -->`. Setup overwrites that block. Notes outside the markers stay.

The block now includes:

- Continuation crumbs that must not be re-triaged
- Tier definitions, including when "when I click" is a bug hunt (`tier_2`) rather than QA
- A maximum of 3 concurrent implementation panes
- How custom tools survive `--no-extensions` (`tools:` plus `registerToolExtension`; there is no `--extension` argument on `subagent()`)
- How to answer `subagent_question` (spec review, fan-out, or a real user question)
- `session-mode: standalone` as the default, so children do not inherit the parent transcript
- Cache discipline via `/cache graph` and `/cache stats` when pi-cache-graph is installed
- The grantable tool-name list

The agent table and the 429 chains stay parameterized. Install writes whatever models you assigned. The template does not pin provider model ids. `qa_tester` uses `thinking: medium`.

## Preferences applied when unset

Install and `ultimate-pi setup agents` / `setup fallbacks` fill these settings only when the key is missing. A theme or compaction value you already set is left alone.

| Setting | Default |
| --- | --- |
| `theme` | `neon-noir` |
| `hideThinkingBlock` | `false` |
| `compaction.enabled` | `true` |
| `compaction.reserveTokens` | `16384` |
| `compaction.keepRecentTokens` | `15000` |
| `graft-context.enabled` | `true` |
| `graft-context.maxHits` | `4` |
| `graft-context.maxChars` | `8000` |
| `graft-context.autoProvision` | `true` |
| `observational-memory.enabledByDefault` | `true`, only when observational memory is installed |

`npm:@spences10/pi-themes` is a required package so `neon-noir` exists.

On macOS, `--yes` and the extras prompt (preselected) enable the completion beep. Setup appends the snippet from `extras/macos/completion-beep.md` after the managed block, and does not append it twice. iTerm2 status stays opt-in. Linux and Windows do not get the beep: `afplay` is macOS-only.

## Background jobs

bash-guard wraps every bash command it allows. Background pids still in the shell job table are written under `<agentDir>/jobs`. `/jobs` lists them. `/jobs kill <pid>` stops that pid and its children, and refuses a pid that was not recorded. Worker starts them. qa_tester has no bash tool, so it can kill a recorded job and cannot start one. The parent session can do both.

## BMAD projects

The BMAD bridge is optional and is not part of a default install. Install asks after the other optional packages: "Install the BMAD bridge? Only if this machine uses BMAD." The default is no, and `--yes` does not select it. A yes installs `git:github.com/VisionCraft3r/ultimate-pi-bmad` and nothing else downloads that tree. `answers.packages` can name that spec. `ultimate-pi setup packages` can add it later.

A v6 install is detected from `_bmad` and `.agents/skills/bmad-agent-*`. The first interactive session asks once: BMAD agents, or Ultimate PI agents. The answer is stored in `{project}/.pi/agent-system` and changes only when you ask, including `/agent-system`.

Ultimate PI mode still calls `jev_triage`. Personas are a short card: name, role, and at most five principles. The planner brief gets one of them (architect, ux-designer, pm, or sm) matching the ask. If a story under `implementation_artifacts` already names files, that list is the map and scout is not spawned. Models stay the five roles from install. They are not asked again.

BMAD mode loads `.agents/skills` and does not send that work to scout, worker, planner, or qa_tester. Bash-guard, edit-guard, and `/jobs` stay on.

An older v6 version can be refreshed with `npx --yes bmad-method@latest install --yes --action quick-update --directory <project>` after you confirm. `_bmad/custom/` is hashed before and after. A changed custom file is not reported as success. Declining writes `declined <latest>` in `.pi/bmad-update`. A tree that is not v6 is left for a manual migration.

## Scout stops after 20 tool rounds

A round is one assistant message that contains tool calls. Round 20 still runs. Scout then gets one chance to return the file and line map. A 21st round is blocked. Worker is unchanged. The ceiling is also written in `templates/agents/scout.md`.

Scout launches with `--no-lens-context`, and pi-lens is not attached to that child. Scout keeps `graft_find_code` and `graft_repo_map`. The rest of the graft and pi-lens tool lists stay on worker and planner. A child's thinking level is passed with `--thinking`, not glued onto the model id.

## Quota switches stay inside the models you enabled

`quota-fallback` still reads `model-agents.json` in the usual order: per-agent chain, then per-provider chain, then a derived default. When `enabledModels` or the session scoped-model list has entries, step three is skipped. A hop from the file is used only when that `provider/id` is in the combined list. An empty list keeps the derived default.

## Planner approval opens Plannotator

`handoff_spec` opens the spec file in the Plannotator browser and waits. Approval writes the `.ask` sidecar for the parent session. A rejection, or a missing Plannotator install, returns the reason and does not send the handoff. `UNATTENDED_MODE=true` skips the browser and hands off as before. Product questions use `ask_user_question`. In a child session that tool parks on the `.ask` sidecar and tells the child to wait.

## Launch update

`launch-update` runs once per session. It can apply patch and minor npm updates that stay on known pins, and it can copy a newer Ultimate Pi checkout into the agent directory only after that checkout's tests pass. Set `ULTIMATE_PI_ROOT` to the checkout. Helpers that are not extension factories are not copied into `extensions/`.

## Left on the maintainer machine

These are not in the repository and are not written by install:

- The `video-ads` agent profile. It stays on the local Pi install and is not written or routed by Ultimate Pi
- Agent model ids and `enabledModels` from the maintainer's `settings.json`
- The hardcoded 429 hop names that used to sit in one local `AGENTS.md`
- `auth.json`, web-search `auth.json`, OAuth tokens, and API keys
- `graft-context.managedRoots` and any other absolute home or Documents path
- `trust.json`, session transcripts, plans, and research notes
- The Paperclip board integration (still a local experiment: mirror, question popups, and the `--print` hold)
- `pi-mcp-adapter` (installed locally with no MCP server config)
- The legacy `iterm2-pi-status.ts` auto-loaded extension; the supported extra remains `extras/macos/iterm2-status.ts`
- Browser profiles, skill virtualenvs, and local binaries
