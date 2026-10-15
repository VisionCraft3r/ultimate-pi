# Maintenance log

Operational record of Pi CLI / extension updates applied to local installs. This
is a run log, not a release changelog — see [CHANGELOG.md](../CHANGELOG.md) for
package changes.

## 2026-10-15 — Grok subagent stream on Cursor 0.5.2

Scope: global `~/.pi/agent` install and the Ultimate PI checkout. Both share the same Pi CLI and the same `@schultzp2020/pi-cursor@0.5.2` proxy.

### Cause

A scout on `cursor/grok-4.7` started, then the assistant text ended with `Connect error internal: KV stream closed` and zero tokens. The proxy log for that request was `[tool-dispatch] rejected unknown exec type { case: undefined, field: 36, id: 0 }`. Field 36 is Cursor's `mcp_state_exec_args`. Grok sends it before `read` / `grep`. The 0.5.2 proto has no such field, so the proxy echoed an empty message and Cursor closed the stream.

npm `latest` for `@schultzp2020/pi-cursor` is still `0.5.3` (published 2026-10-08). That build cannot import `@earendil-works/pi-ai`. The same day the upstream repo removed the package (`chore!: remove Cursor and require native Pi 1.1.0`). Pi `1.3.0` (published today) does not add a Cursor subscription provider. The pin stays `0.5.2`.

### Applied

- `patches/pi-cursor-mcp-state-0.5.2.patch` on the idle-patched `dist/proxy/main.js`. Field 36 is answered with the session's `mcp_pi_*` catalog. Field 28 (Cursor's own subagent call, which carries a model id) is answered with an error so the child keeps the model already selected by `/agents`.
- The same patch is in `DEPENDENCY_PATCHES`, so `ultimate-pi install` applies it after the idle patch on a fresh `0.5.2` tree.
- Local proxy file hash is `954befc4e657acf7d892a525105a4d65852754223c0d581bc593d9964c597f8c`. A first patched run answered field 36 (`answered mcp state exec`, 40 tools). The follow-up then died on `listMcpResourcesExecArgs`, and after that probe was answered the tool-result request still reset the Cursor conversation: commit counts the current user text, but a tool-result request parses zero completed turns, so lineage reset and Cursor closed the KV stream. The patch keeps that in-progress user text in the lineage check when the last message is a tool result.

### Selector

`/agents` writes `model: cursor/grok-4.7` and leaves `thinking` on its own line. Spawn passes `--model` and `--thinking` as separate arguments. The 2026-10-15 scout session's `model_change` was `cursor` / `grok-4.7`. A print-mode turn with `--model cursor/grok-4.7 --thinking off` and no tool call returned `pong`.

### Live read

A print-mode read of `ultimate-pi/package.json` on the patched proxy still ends with `Connect error internal: KV stream closed`. The probe is exec field 36, exec id 0, empty `execId`, plus bool field 55 (`acceptHookAdditionalContexts`), and the args name the `pi` server (`040a027069`). An empty reply, an error result, a connected-server success, and skipping the id-0 stream close all still closed that stream. Leaving the probe unanswered dropped the bridge (`bridge connection lost`). The follow-up request is a new user message that contains the error text, not a `tool` role, so the lineage guard does not apply to it. The patch stays because it replaces the empty frame and covers the resource-list and tool-result cases that do have a real exec id.

## 2026-10-11 — Pi 1.1.0 alignment

Scope: global `~/.pi/agent` install and the Ultimate PI checkout. Both share the same Pi CLI.

### Applied

- **Pi CLI**: already `1.1.0`, which is the npm `latest` tag. `pi update --all` reported it up to date and refreshed the two git checkouts. Both were already on `origin/main` (`pi-interactive-subagents` `c3e8b53`, `pi-observational-memory` `78a1efc`). Local patches, including the global agent-model resume change, were still present afterward.
- **Ultimate PI lockfile**: `@earendil-works/pi-coding-agent`, `pi-ai`, `pi-tui`, and `pi-agent-core` moved from `1.0.0` to `1.1.0` inside the existing `^1.0.0` peer range. `npm test` 290/290 and `npm run typecheck` passed.

### Held

- **`@schultzp2020/pi-cursor`**: npm `latest` is `0.5.3`. That build still cannot import `@earendil-works/pi-ai` from the agent tree, so the install stays on the settings pin `npm:@schultzp2020/pi-cursor@0.5.2`. After the update, `cursor/grok-4.7` still lists.
- **`pi-mcp-adapter`**: installed `3.3.0` (pinned in settings). npm `latest` is `5.2.0`, a major bump, so it was not installed.

### Verification

- `pi --version` is `1.1.0`.
- `pi --list-models cursor/grok-4.7` lists the model.
- Ultimate PI: 290 tests passed, typecheck clean.

## 2026-10-11 — Cursor provider pin and agent-model reload

Scope: global `~/.pi/agent` install and the Ultimate PI checkout.

### Applied

- Reinstalled `@schultzp2020/pi-cursor@0.5.2` after `pi update` had floated the unpinned settings spec to `0.5.3`. That build imports `@earendil-works/pi-ai`, which is not resolvable from the agent npm tree, so a Cursor model aborted the turn and the provider never registered.
- Settings spec is `npm:@schultzp2020/pi-cursor@0.5.2`. The idle and stale-context 0.5.2 patches were reapplied.
- `web_fetch` no longer throws when the copied extension cannot see `../../package.json`.
- Subagent resume reads `model` and `thinking` from `~/.pi/agent/agents/<name>.md` after `/reload`. The rest of the sandbox snapshot is unchanged.

### Verification

- Import of `pi-cursor/dist/index.js` succeeds.
- `pi --list-models cursor/grok-4.7` lists the model.
- A print-mode start in this checkout loaded extensions and reached the model request.

## 2026-10-08 — Pi CLI + extension update

Scope: global `~/.pi/agent` install (shared by Ultimate PI and the local Pi
instance on this machine — same install, one pass covers both).

### Applied

- **Pi CLI**: `1.0.3 → 1.1.0` via `pi update self`. Verified: Ultimate PI test
  suite 232/232 passing before and after.
- **`pi-interactive-subagents`**, **`pi-observational-memory`** (git-sourced
  extensions): refreshed to latest via `pi update --all`.

### Held / reverted (guarded by design)

- **`@schultzp2020/pi-cursor`**: `pi update --all` pulled this to `0.5.3`, but
  `ultimate-pi/lib/launch-update.ts` pins it at `0.5.2` (`PATCH_PINS`) because
  `0.5.3` is a known-bad build for this setup. Reinstalled the exact `0.5.2`
  build and re-pinned it in agent settings (`npm:@schultzp2020/pi-cursor` →
  exact `0.5.2` in `~/.pi/agent/npm/package.json`).
- **`@plannotator/pi-extension`**: held by `launch-update.ts`'s own gate
  (requires detected Pi ≥ 0.79.1; detection only resolves correctly when run
  through the real launcher, not a standalone invocation of the script).
- **`pi-lens`** `4.3.0 → 4.4.0`: attempted by `launch-update.ts`, install did
  not go cleanly, auto-reverted to `4.3.0` by the script's own safety net.
- **`pi-mcp-adapter`** `3.3.0 → 5.1.0`: major version bump, held automatically
  — `launch-update.ts` does not auto-apply majors.

### Verification

- `npm test` in `ultimate-pi/` — 232/232 passing (ran twice: once after the Pi
  CLI bump, once after correcting pi-cursor back to its pin).
- `pi list` — all twelve extensions still resolve to installed paths.
- `pi --version` — confirms `1.1.0`.

### Notes

No source files in this repository changed as part of the update itself (the
managed routing block, patches, and extension pins in `lib/launch-update.ts`
already encoded the correct guardrails and did not need edits). This log entry
is the only repo change from this maintenance pass.
