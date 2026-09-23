# Completion beep (macOS extra, opt-in)

This snippet is **macOS-only** and **optional**. The installer offers it only on `darwin`.
Paste it into your own `AGENTS.md` (inside the Ultimate Pi marker block if you use one) if you want an audible ping when the **main session** finishes a turn.

The terminal bell character (`\a`) is often disabled or silent, so this uses `afplay` against a built-in macOS system sound instead.

```markdown
# COMPLETION BEEP
After finishing a task/response in this main session, play an audible completion sound: `afplay /System/Library/Sounds/Ping.aiff`. The terminal bell character (`\a`) is not reliable (bell often disabled/silent) — use `afplay` instead.
```

Other built-in sounds you can swap in: `/System/Library/Sounds/Glass.aiff`, `Pop.aiff`, `Tink.aiff`.

Skip this extra on Linux and Windows; `afplay` is not available there.
