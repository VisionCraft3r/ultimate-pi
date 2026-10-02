# Dependency patches

Small unified patches for specific third-party Pi package versions. These
are **not** vendored upstream trees. The installer checks package version and
the full target SHA-256, makes a timestamped backup, applies the patch, and
verifies the post-image hash. Already-applied files are left unchanged; an
unknown version or modified build is **reported and skipped**, never patched
blindly. Offline/dry-run installation does not apply patches.

## `pi-interactive-subagents-activity.patch`

| | |
| --- | --- |
| Package | [`pi-interactive-subagents`](https://github.com/amosblomqvist/pi-interactive-subagents) **3.7.2** |
| Pinned git commit | `c3e8b53c0754ae5ccc19fdab5a7481ec039bc2f7` (`main`, 2026-08-25, "updated readme and test") |
| Target file | `pi-extension/subagents/activity.ts` |
| Pre-image blob (`git rev-parse HEAD:pi-extension/subagents/activity.ts`) | `5fd2f7a961ac4de4335405bb6cacd8dd9c84df8c` |
| Post-image blob | `e406d7194f83e1db8228ef1d91c6719be5d4437b` |
| Pre-image SHA-256 | `2f8ef422f668e7e8fddfe084f37ebe6ee44865ce32c2a981a765bb6c213b2c61` |
| Post-image SHA-256 | `e37f908e912ade6eebfc4048e7bc71898597f89f630da9f5c2fca1dd1db45324` |

### Intended behavior

Activity snapshot strings `toolCallId`, `toolName`, and `messageEventType` are
sanitized on **write** (the activity recorder) and on **read** (JSON
validate/normalize), instead of rejecting the snapshot:

1. Collapse any run of `\r` / `\n` to a single space.
2. Cap the result at 200 characters (`MAX_ACTIVITY_STRING_LENGTH`).
3. Leave missing / `undefined` values unchanged. Non-string values are still
   rejected.

This keeps snapshots valid when a provider embeds a newline in a tool id
(for example Cursor-style `call-1\nfc_2`).

## `pi-interactive-subagents-stale-ctx.patch`

| | |
| --- | --- |
| Package | [`pi-interactive-subagents`](https://github.com/amosblomqvist/pi-interactive-subagents) **3.7.2** |
| Pinned git commit | `c3e8b53c0754ae5ccc19fdab5a7481ec039bc2f7` (`main`, 2026-08-25, "updated readme and test") |
| Target file | `pi-extension/subagents/index.ts` |
| Pre-image blob (`git rev-parse HEAD:pi-extension/subagents/index.ts`) | `7e20a0fcec3a9316eaeba1d6957f1893b18163f7` |
| Post-image blob | `2266f5a7a8e82aa9c358ec39a7dd53420ebf38f1` |
| Pre-image SHA-256 | `0a438726c0a9e5bd02d0b87141b41238aae7c39ac2faa4f4a96eb0f5e1ecb1a4` |
| Post-image SHA-256 | `96dfdb1d722fcb6a478ccf919aae698b5f6f2fe6b770145aeca6acb21f711136` |

### Intended behavior

Status updates, questions, and subagent results are delivered through
`deliverToParent`. A session Pi has already replaced cannot accept that steer.
The call returns without throwing, so the tmux child stays up. The child
session file still holds the result. This file is independent of the activity
patch.

## `pi-graft-async-0.1.2.patch`

| | |
| --- | --- |
| Package | [`pi-graft`](https://www.npmjs.com/package/pi-graft) **0.1.2** |
| Target file | `extensions/graft.ts` |
| Pre-image SHA-256 | `663479e235ac247211f64e5d6015995d8cff04e33726fc639eaa0b1edfe5e6bb` |
| Post-image SHA-256 | `11502aa5ae65d8b0a8a852c5903fe02982e812e3f1b64d3d1eb4bf458f1ec78e` |

### Intended behavior

`graft ask` and `graft check` no longer run through `execFileSync` on the prompt, edit, or settle paths. A prompt waits at most 1.5s for retrieval and is sent without it if graft is slower. Drift checks after an edit and at settle update stats in the background. Continuation crumbs skip retrieval, matching jev-triage. A checksum that is not the published preimage or this post-image is left untouched. Once `pi-graft-subagent-task.patch` is applied, this file's hash is that patch's post-image, and this patch counts as already applied.

## `pi-graft-subagent-task.patch`

| | |
| --- | --- |
| Package | [`pi-graft`](https://www.npmjs.com/package/pi-graft) **0.1.2** |
| Target file | `extensions/graft.ts` |
| Pre-image SHA-256 | `11502aa5ae65d8b0a8a852c5903fe02982e812e3f1b64d3d1eb4bf458f1ec78e` |
| Post-image SHA-256 | `0e80c4207393e90cd862514cc6e4ef3c5b0cf925a770f89cc2b32c7b277503a4` |

Applies after the async patch. In a subagent (`PI_SUBAGENT_AGENT`), graft does not append the orientation message. That message was the next turn after the task file, and the worker answered it with `graft_repo_map` and then exited. The task line is added to the system prompt instead: the user message, including text inside a `<file>` tag, is the task. Parent sessions still get the orientation message.

## `pi-graft-stale-ctx-0.1.2.patch`

| | |
| --- | --- |
| Package | [`pi-graft`](https://www.npmjs.com/package/pi-graft) **0.1.2** |
| Target file | `extensions/graft.ts` |
| Pre-image SHA-256 | `0e80c4207393e90cd862514cc6e4ef3c5b0cf925a770f89cc2b32c7b277503a4` |
| Post-image SHA-256 | `0f9002d52221f57fbbcd0bf6d1f5e123f94532eed49a9e051efd0bc55cd91f51` |

Applies after the subagent-task patch. `session_start` and `turn_end` read the session context inside the existing try/catch. A live session still refreshes status and tallies graft usage. A context that Pi has already replaced returns without failing the turn.

## `pi-cursor-stale-ctx-0.5.2.patch`

| | |
| --- | --- |
| Package | [`@schultzp2020/pi-cursor`](https://www.npmjs.com/package/@schultzp2020/pi-cursor) **0.5.2** |
| Target file | `dist/index.js` |
| Pre-image SHA-256 | `ac2b0544559910f836e627a8c292ea303492b7100174bf0ca3b30a7cab1fa900` |
| Post-image SHA-256 | `180c81c74411948dfed5b41ad441416cdd172f69fbae58576bc7b3638204664d` |

`session_start` and `before_provider_request` ignore a replaced session context. A live Cursor request still attaches the session id and working directory. If the context throws, the original provider payload is returned unchanged.

## `pi-cursor-idle-0.5.2.patch`

| | |
| --- | --- |
| Package | [`@schultzp2020/pi-cursor`](https://www.npmjs.com/package/@schultzp2020/pi-cursor) **0.5.2** |
| Published tarball | `https://registry.npmjs.org/@schultzp2020/pi-cursor/-/pi-cursor-0.5.2.tgz` |
| Target file | `dist/proxy/main.js` |
| Pre-image SHA-256 | `fac8964e80770c7003d1c8719c08fd834a723eb3fc4ccb1442d5ef3a57429bed` |
| Post-image SHA-256 | `4d05e91ce9b1de36c1289a70a40db91407bf284d93c6c9a2ae9501166dec3b24` |

The thinking idle window is 120 seconds, streaming idle is 60 seconds, and
thinking output does not switch the timer phase until real text arrives.
A locally modified build whose full-file hash differs is skipped, even if it
already contains some of these changes.

## `pi-graft-workspace-stats-0.1.2.patch`

| | |
| --- | --- |
| Package | `pi-graft` **0.1.2** (target `extensions/graft.ts`) |
| Pre-image SHA-256 | `0f9002d52221f57fbbcd0bf6d1f5e123f94532eed49a9e051efd0bc55cd91f51` |
| Post-image SHA-256 | `db3eef0b520bebaf0afe9457e7013c431676793ea00cf20fdeb5aaf9965e4d1d` |

When `graft/workspace.json` exists, footer stats aggregate the children's
`graft/.graph/wiring.json` counts and append `[workspace N/M; no graph: …]`
for children without a graph. Single repos behave as before.

## `pi-graft-settled-stale-0.1.2.patch`

| | |
| --- | --- |
| Package | `pi-graft` **0.1.2** (target `extensions/graft.ts`) |
| Pre-image SHA-256 | `db3eef0b520bebaf0afe9457e7013c431676793ea00cf20fdeb5aaf9965e4d1d` |
| Post-image SHA-256 | `e3f2684791d8d44fc909d84a887f58996001307be71bb3fdb10fbead5dfc6bdb` |

Applies after the workspace-stats patch. `before_agent_start`, `tool_result`, and `agent_settled` read `ctx.cwd` inside a try/catch. A live session still tallies and refreshes graft. A context Pi has already replaced returns without failing the turn.

## Observational memory stale context

| | |
| --- | --- |
| Package | `observational-memory` **0.1.0** |
| Commit the preimages were taken from | `78a1efcfdd46332253fb289724f05b26dfc7769e` |

| Patch | Target | Pre-image | Post-image |
| --- | --- | --- | --- |
| `pi-observational-memory-observer-stale.patch` | `src/hooks/observer-trigger.ts` | `0bfe292de9bfd3e95a48e7499f98401d69a07b4e4f77602f9cc27945fbd87db9` | `f45758d173508b0384447d790531d401e29374e78b5472287f081eb67a24f8c0` |
| `pi-observational-memory-consolidator-stale.patch` | `src/hooks/consolidator-trigger.ts` | `4594cd243c4a5aff2e11e057dd4b0431fd76fc1e6506c0695e57a7bc1229e121` | `766634f8364569369ef7d78012363a7aa84ac679620b8f6db9436f6dee7dd061` |
| `pi-observational-memory-compaction-stale.patch` | `src/hooks/compaction-trigger.ts` | `6d3e7abc671d8ed6d0c3706d3d74f0277e541038e35d03fadc11b2210edcf2d0` | `cb757631b32a76f4a49fe6c11d2bde41bcd6d3bd172a7857bdc5c7ca0d1f2bc7` |

Observer and consolidator copy the session getters once and return when Pi has already replaced the session. Compaction's `turn_end` handler does the same. A live session still dispatches workers and compacts. A checksum that is not the preimage or post-image is left untouched.
