# What a fresh install matches

A new `ultimate-pi install` follows the same operating rules as the maintainer's Pi session: graft and pi-lens before broad reads, JEV tiers, a cap of three concurrent implementation panes, checkpointed milestones, cache discipline, and a dedicated video-ad role. Model ids stay yours.

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

The agent table and the 429 chains stay parameterized. Install writes whatever models you assigned. The template does not pin provider model ids.

## `video-ads`

Sixth shipped role, next to scout, worker, planner, researcher, and qa_tester. The orchestrator uses it instead of `worker` when the leaf is a video ad, promo, or HyperFrames composition. It counts toward the cap of 3. It is not a general code worker.

The profile's `model:` is `{{model}}`. When OpenAI Codex is one of the providers you configured, `--yes` prefers that provider for this role, the same way researcher does, and still takes the model id from your catalog or your answers file. `thinking` is `high`. `qa_tester` uses `thinking: medium`.

HyperFrames skills are read from Pi's normal skill discovery. The profile does not contain a home-directory path. If the skill is not installed, the agent stops and says so.

Install writes `agents/video-ads.md` with the other role profiles.

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

## Quota switches stay inside the models you enabled

`quota-fallback` still reads `model-agents.json` in the usual order: per-agent chain, then per-provider chain, then a derived default. When `enabledModels` or the session scoped-model list has entries, step three is skipped. A hop from the file is used only when that `provider/id` is in the combined list. An empty list keeps the derived default.

## Planner approval opens Plannotator

`handoff_spec` opens the spec file in the Plannotator browser and waits. Approval writes the `.ask` sidecar for the parent session. A rejection, or a missing Plannotator install, returns the reason and does not send the handoff. `UNATTENDED_MODE=true` skips the browser and hands off as before. Product questions use `ask_user_question`. In a child session that tool parks on the `.ask` sidecar and tells the child to wait.

## Launch update

`launch-update` runs once per session. It can apply patch and minor npm updates that stay on known pins, and it can copy a newer Ultimate Pi checkout into the agent directory only after that checkout's tests pass. Set `ULTIMATE_PI_ROOT` to the checkout. Helpers that are not extension factories are not copied into `extensions/`.

## Left on the maintainer machine

These are not in the repository and are not written by install:

- Agent model ids and `enabledModels` from the maintainer's `settings.json`
- The hardcoded 429 hop names that used to sit in one local `AGENTS.md`
- `auth.json`, web-search `auth.json`, OAuth tokens, and API keys
- `graft-context.managedRoots` and any other absolute home or Documents path
- `trust.json`, session transcripts, plans, and research notes
- The Paperclip board integration (still a local experiment: mirror, question popups, and the `--print` hold)
- `pi-mcp-adapter` (installed locally with no MCP server config)
- The legacy `iterm2-pi-status.ts` auto-loaded extension; the supported extra remains `extras/macos/iterm2-status.ts`
- Browser profiles, skill virtualenvs, and local binaries
