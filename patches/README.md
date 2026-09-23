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
