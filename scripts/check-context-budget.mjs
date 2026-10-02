/**
 * Fail when the managed routing block grows past its budget.
 * The budget is the size after the de-dupe in this package. Raise it only
 * in the same change that adds routing text on purpose.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const MANAGED_BEGIN = "<!-- ultimate-pi:begin -->";
export const MANAGED_END = "<!-- ultimate-pi:end -->";

/** Bytes of the current template block. Ratcheted after the session-audit hardening section. */
export const CONTEXT_BUDGET_BYTES = 17408;

export function managedBlockBytes(text) {
  const begin = text.indexOf(MANAGED_BEGIN);
  const end = text.indexOf(MANAGED_END);
  if (begin < 0 || end < begin) return null;
  return Buffer.byteLength(text.slice(begin, end + MANAGED_END.length), "utf8");
}

function templatePath() {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "templates", "AGENTS.md.tmpl");
}

function main() {
  const text = readFileSync(templatePath(), "utf8");
  const bytes = managedBlockBytes(text);
  if (bytes == null) {
    console.error("AGENTS.md.tmpl is missing ultimate-pi markers");
    process.exit(1);
  }
  if (bytes > CONTEXT_BUDGET_BYTES) {
    console.error(
      `Managed routing block is ${bytes} bytes (budget ${CONTEXT_BUDGET_BYTES}). Shorten templates/AGENTS.md.tmpl or raise the budget in the same change.`,
    );
    process.exit(1);
  }
  console.log(`routing block ${bytes} bytes (budget ${CONTEXT_BUDGET_BYTES})`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
