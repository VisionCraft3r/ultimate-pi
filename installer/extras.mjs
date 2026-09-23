import * as p from "@clack/prompts";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXTRAS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ITERM_STATUS_SRC = path.join(EXTRAS_DIR, "..", "extras", "macos", "iterm2-status.ts");
const COMPLETION_BEEP_DOC = path.join(EXTRAS_DIR, "..", "extras", "macos", "completion-beep.md");

function isCancelled(value) {
  if (p.isCancel(value)) {
    p.cancel("Extras setup cancelled.");
    process.exit(0);
  }
  return value;
}

/**
 * Offers macOS-only opt-in extras. On non-darwin platforms this returns
 * immediately with an empty list and prompts nothing — these extras are
 * never offered off macOS.
 */
export async function configureExtras(options) {
  if (process.platform !== "darwin") {
    return { enabledExtras: [] };
  }

  if (options.answers?.extras?.enabledExtras) {
    return { enabledExtras: options.answers.extras.enabledExtras };
  }

  if (options.yes || options.dryRun || options.answers) {
    return { enabledExtras: [] };
  }

  p.log.step("macOS extras (optional)");
  p.log.info(
    "These are small, opt-in conveniences that only make sense on macOS. Skip either with a blank answer.",
  );

  const choices = isCancelled(
    await p.multiselect({
      message: "Enable macOS extras?",
      options: [
        {
          value: "iterm2-status",
          label: "iTerm2 status line",
          hint: "shows session/tool/prompt state in the iTerm2 status bar (needs a cc-status binary)",
        },
        {
          value: "completion-beep",
          label: "Completion beep",
          hint: "plays a short sound (afplay) when Ultimate Pi finishes a turn",
        },
      ],
      required: false,
    }),
  );

  const enabledExtras = choices ?? [];

  if (enabledExtras.includes("iterm2-status")) {
    p.log.info(
      `iTerm2 status line: add "${path.relative(process.cwd(), ITERM_STATUS_SRC)}" to your pi extensions ` +
        `(or set ULTIMATE_PI_ITERM_STATUS_BIN if your cc-status binary lives somewhere non-default).`,
    );
  }

  if (enabledExtras.includes("completion-beep")) {
    let snippet = "afplay /System/Library/Sounds/Ping.aiff";
    try {
      const doc = await fs.readFile(COMPLETION_BEEP_DOC, "utf8");
      const match = doc.match(/`([^`]*afplay[^`]*)`/);
      if (match) snippet = match[1];
    } catch {
      // fall back to the default snippet above
    }
    p.log.info(
      `Completion beep: add this to your AGENTS.md if you want it — "${snippet}". ` +
        "Not applied automatically; it's a personal preference, not shared config.",
    );
  }

  if (enabledExtras.length === 0) {
    p.log.info("No macOS extras enabled. Re-run `ultimate-pi setup extras` anytime.");
  }

  return { enabledExtras };
}
