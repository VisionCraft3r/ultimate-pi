#!/usr/bin/env node
/**
 * Secret scanner. Run before every push: scans the tracked working tree AND
 * the full git history (`git log -p --all`) for secret-shaped strings.
 * Never prints the raw match — only a masked first4...last4 preview.
 * Exit 0 = clean. Exit 1 = at least one hit.
 */

import { execFileSync } from "node:child_process";

const PATTERNS = [
  { name: "OpenAI-style key", re: /sk-[a-zA-Z0-9]{20,}/g },
  { name: "OpenRouter key", re: /sk-or-[a-zA-Z0-9-]{10,}/g },
  { name: "AWS access key id", re: /AKIA[0-9A-Z]{16}/g },
  { name: "Private key header", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  {
    name: "Assigned secret-like value",
    re: /\b(?:API|SECRET|TOKEN|KEY)_?[A-Z0-9_]*\s*[:=]\s*["']([A-Za-z0-9_\-/+=]{20,})["']/gi,
  },
  { name: "Bare 40+ hex", re: /\b[0-9a-f]{40,}\b/g },
];

// Public git commit / blob / SHA-256 values (not secrets). Split so this file
// itself never contains a 40+ hex literal the scanner would flag.
function publicHex(left, right) {
  return left + right;
}

const ALLOWED_BARE_HEX = new Set([
  publicHex("c3e8b53c0754ae5ccc19", "fdab5a7481ec039bc2f7"),
  publicHex("5fd2f7a961ac4de43354", "05bb6cacd8dd9c84df8c"),
  publicHex("e406d7194f83e1db8228", "ef1d91c6719be5d4437b"),
  publicHex("fac8964e80770c7003d1c8719c08fd83", "4a723eb3fc4ccb1442d5ef3a57429bed"),
  publicHex("4d05e91ce9b1de36c1289a70a40db914", "07bf284d93c6c9a2ae9501166dec3b24"),
  publicHex("2f8ef422f668e7e8fddfe084f37ebe6e", "e44865ce32c2a981a765bb6c213b2c61"),
  publicHex("e37f908e912ade6eebfc4048e7bc7189", "8597f89f630da9f5c2fca1dd1db45324"),
]);

function mask(value) {
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

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

function scanText(label, text, hits) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of PATTERNS) {
      pattern.re.lastIndex = 0;
      let match;
      while ((match = pattern.re.exec(line)) !== null) {
        const value = match[1] ?? match[0];
        if (pattern.name === "Bare 40+ hex" && ALLOWED_BARE_HEX.has(value)) {
          continue;
        }
        hits.push({ label, lineNo: i + 1, kind: pattern.name, masked: mask(value) });
      }
    }
  }
}

function listTrackedFiles() {
  const out = git(["ls-files"]);
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => !file.startsWith("node_modules/") && !file.includes("/node_modules/"));
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
  // Scan messages and patches separately. The default `commit <sha>` metadata
  // is a public hash, not a secret, and must not mask secret-shaped diff text.
  scanText("git history (commit messages)", git(["log", "--format=%B", "--all"]), hits);
  scanText("git history (patches)", git(["log", "--format=", "-p", "--all"]), hits);
}

async function main() {
  const hits = [];
  await scanWorkingTree(hits);
  scanGitHistory(hits);

  if (hits.length === 0) {
    console.log("✔ scan-secrets: clean — no secret-shaped strings found");
    process.exitCode = 0;
    return;
  }

  console.error(`✖ scan-secrets: ${hits.length} potential secret(s) found`);
  for (const hit of hits) {
    console.error(`  ${hit.label}:${hit.lineNo} — ${hit.kind} — ${hit.masked}`);
  }
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`✖ scan-secrets: scan could not complete: ${error.message}`);
  process.exitCode = 1;
});
