# Completion beep (macOS extra)

This snippet is **macOS-only**. On darwin, `ultimate-pi install` and `ultimate-pi setup extras` append it **outside** the `<!-- ultimate-pi:begin/end -->` markers when the completion-beep extra is enabled. `--yes` enables it. The extras prompt preselects it; clear it to skip. It is not applied on Linux or Windows.

The terminal bell character (`\a`) is often disabled or silent, so this uses `afplay` against a built-in macOS system sound instead.

```markdown
# COMPLETION BEEP
After finishing a task/response in this main session, play an audible completion sound: `afplay /System/Library/Sounds/Ping.aiff`. The terminal bell character (`\a`) is not reliable (bell often disabled/silent) — use `afplay` instead.
```

Other built-in sounds you can swap in: `/System/Library/Sounds/Glass.aiff`, `Pop.aiff`, `Tink.aiff`.

Skip this extra on Linux and Windows; `afplay` is not available there.
