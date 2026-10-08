# Maintenance log

Operational record of Pi CLI / extension updates applied to local installs. This
is a run log, not a release changelog — see [CHANGELOG.md](../CHANGELOG.md) for
package changes.

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
