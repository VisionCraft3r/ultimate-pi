#!/usr/bin/env node
/**
 * Personal-string scanner. Run before every push alongside scan-secrets.mjs.
 * Scans the tracked working tree AND the full git history (`git log -p --all`)
 * for personal-identifying strings that shouldn't ship in a generic public
 * template: hardcoded personal home-dir paths and denylisted terms (DENY_TERMS,
 * matched with word-boundary regexes to avoid false positives like "cursor
 * provider"). DENY_TERMS is kept in sync with .gitleaks.toml by
 * test/scan-personal.test.ts.
 *
 * DENY_TERMS is intentionally maintainer-editable — add anything specific to
 * your own environment before publishing. Unlike scan-secrets.mjs, hits here
 * are NOT masked (there's nothing secret about a name, only something
 * personal), so the context snippet is printed as-is for easy triage.
 *
 * Exit 0 = clean. Exit 1 = at least one hit.
 */

import { execFileSync } from "node:child_process";

/** Single denylist term set, enforced identically here and in .gitleaks.toml (kept in sync by test/scan-personal.test.ts). */
export const DENY_TERMS = ["fatima", "midas", "al-furat", "macai", "godseye", "pc5d", "cursor pro", "ultimatepi"];

/**
 * Terms that already appear in published git history (outside this rule's own
 * definition in scripts/scan-personal.mjs / .gitleaks.toml). Rewriting history
 * is out of scope, so these are checked in the working tree only and skipped
 * during the `git log -p --all` scan. `ultimatepi` hits because older commits
 * reference a `Documents/UltimatePI/ultimate-pi` path that predates the
 * source-root lookup fix.
 */
export const TREE_ONLY_TERMS = ["ultimatepi"];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function denyTermPattern(term) {
  return new RegExp("\\b" + escapeRegExp(term) + "\\b", "i");
}

/** Path fragments that indicate a hardcoded personal home directory rather than a generic placeholder.
 *  Additive to NAME_DENYLIST: flags ANY committer's macOS `/Users/<name>/` or Linux `/home/<name>/` path. */
const PATH_PATTERNS = [
  /\/Users\/(?!YOUR_USERNAME|Shared|Guest|<[^>]+>|placeholder|me\/)[A-Za-z0-9._-]+/g,
  /\/home\/(?!YOUR_USERNAME|Shared|Guest|<[^>]+>|placeholder|me\/)[A-Za-z0-9._-]+/g,
];

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 256, stdio: ["ignore", "pipe", "pipe"] });
}

function hasHistory() {
  try {
    git(["rev-parse", "--verify", "HEAD"]);
    return true;
  } catch {
    return false; // A fresh git init has no commits to scan yet.
  }
}

/** Files that intrinsically contain the denylisted literals to define the rule itself, not a leak. */
const SELF_EXEMPT_FILES = new Set(["scripts/scan-personal.mjs", ".gitleaks.toml"]);

function listTrackedFiles() {
  const out = git(["ls-files"]);
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => !file.startsWith("node_modules/") && !file.includes("/node_modules/"))
    .filter((file) => !SELF_EXEMPT_FILES.has(file));
}

function contextSnippet(line, maxLen = 160) {
  const trimmed = line.trim();
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}…` : trimmed;
}

function scanText(label, text, hits, { skipTerms = [] } = {}) {
  const lines = text.split("\n");
  const skip = new Set(skipTerms);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const term of DENY_TERMS) {
      if (skip.has(term)) continue;
      if (denyTermPattern(term).test(line)) {
        hits.push({ label, lineNo: i + 1, kind: `denylisted term "${term}"`, snippet: contextSnippet(line) });
      }
    }

    for (const pattern of PATH_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(line)) !== null) {
        const captured = match[0];
        if (captured.length === 0) {
          pattern.lastIndex = match.index + 1;
          continue;
        }
        hits.push({ label, lineNo: i + 1, kind: "hardcoded personal path", snippet: contextSnippet(line) });
      }
    }
  }
}

async function scanWorkingTree(hits) {
  const files = listTrackedFiles();
  const fs = await import("node:fs/promises");
  for (const file of files) {
    let text;
    try {
      text = await fs.readFile(file, "utf8");
    } catch {
      continue; // binary or unreadable — skip
    }
    scanText(file, text, hits);
  }
}

function scanGitHistory(hits) {
  if (!hasHistory()) return;
  const log = git(["log", "-p", "--all"]);
  if (!log) return;
  // Split into per-file diff hunks so SELF_EXEMPT_FILES (which intrinsically
  // contain the denylisted literals to define the rule) don't self-trigger
  // on every commit that touches them.
  const lines = log.split("\n");
  let currentFile = null;
  let buffer = [];
  const flush = () => {
    if (buffer.length === 0) return;
    if (!currentFile || !SELF_EXEMPT_FILES.has(currentFile)) {
      scanText("git history (log -p --all)", buffer.join("\n"), hits, { skipTerms: TREE_ONLY_TERMS });
    }
    buffer = [];
  };
  const diffHeader = /^diff --git a\/(.+?) b\/(.+)$/;
  for (const line of lines) {
    const match = diffHeader.exec(line);
    if (match) {
      flush();
      currentFile = match[2];
    }
    buffer.push(line);
  }
  flush();
}

async function main() {
  const hits = [];
  await scanWorkingTree(hits);
  scanGitHistory(hits);

  if (hits.length === 0) {
    console.log("✔ scan-personal: clean — no personal-identifying strings found");
    process.exitCode = 0;
    return;
  }

  console.error(`✖ scan-personal: ${hits.length} potential personal string(s) found`);
  for (const hit of hits) {
    console.error(`  ${hit.label}:${hit.lineNo} — ${hit.kind} — ${hit.snippet}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`✖ scan-personal: scan could not complete: ${error.message}`);
    process.exitCode = 1;
  });
}
