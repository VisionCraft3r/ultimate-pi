import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  AGENTS_MD_BEGIN_MARKER,
  AGENTS_MD_END_MARKER,
  assertThinkingLevel,
  listAgentProfiles,
  replaceFrontmatterField,
  writeAgentModel,
  writeAgentThinking,
} from "../lib/model-agents.ts";

const PROFILE = `---
name: scout
description: Reconnaissance
model: cursor/cursor-grok-4.6-medium
thinking: medium
tools: read, grep
---

# Scout
`;

function tempAgentDir(): string {
  const root = mkdtempSync(join(tmpdir(), "agent-config-"));
  mkdirSync(join(root, "agents"));
  writeFileSync(join(root, "settings.json"), `{"enabledModels":["cursor/cursor-grok-4.6-medium"]}\n`);
  return root;
}

test("profiles include extra agents and skip ultimate-pi sidecars", () => {
  const root = tempAgentDir();
  writeFileSync(join(root, "agents", "video-ads.md"), PROFILE.replace("name: scout", "name: video-ads"));
  writeFileSync(join(root, "agents", "video-ads.ultimate-pi.md"), PROFILE);
  writeFileSync(join(root, "agents", "notes.txt"), "no");
  const names = listAgentProfiles(root).map((profile) => profile.name);
  assert.deepEqual(names, ["video-ads"]);
  assert.equal(listAgentProfiles(root)[0]?.model, "cursor/cursor-grok-4.6-medium");
  assert.equal(listAgentProfiles(root)[0]?.thinking, "medium");
});

test("thinking is replaced when present and inserted when missing", () => {
  const replaced = replaceFrontmatterField(PROFILE, "thinking", "high");
  assert.match(replaced ?? "", /^thinking: high$/m);
  assert.doesNotMatch(replaced ?? "", /^thinking: medium$/m);
  const bare = PROFILE.replace("thinking: medium\n", "");
  const inserted = replaceFrontmatterField(bare, "thinking", "low");
  assert.match(inserted ?? "", /^thinking: low$/m);
  assert.match(inserted ?? "", /^model: cursor\/cursor-grok-4\.6-medium$/m);
});

test("an invalid thinking level is rejected before any write", () => {
  assert.throws(() => assertThinkingLevel("turbo"), /invalid thinking level/);
  assert.equal(assertThinkingLevel("xhigh"), "xhigh");
  const root = tempAgentDir();
  writeFileSync(join(root, "agents", "scout.md"), PROFILE);
  assert.throws(() => writeAgentThinking("scout", "turbo", root), /invalid thinking level/);
  assert.match(readFileSync(join(root, "agents", "scout.md"), "utf8"), /^thinking: medium$/m);
});

test("a model change updates frontmatter and the marker cell only", () => {
  const root = tempAgentDir();
  writeFileSync(join(root, "agents", "scout.md"), PROFILE);
  const outside = "user note stays\n";
  const agents = `${outside}${AGENTS_MD_BEGIN_MARKER}\n| \`scout\` | \`cursor/old\` |\n${AGENTS_MD_END_MARKER}\n`;
  writeFileSync(join(root, "AGENTS.md"), agents);
  const result = writeAgentModel("scout", "cursor/composer-2.5", root);
  assert.equal(result.enabledAdded, true);
  const profile = readFileSync(join(root, "agents", "scout.md"), "utf8");
  assert.match(profile, /^model: cursor\/composer-2\.5$/m);
  assert.match(profile, /^thinking: medium$/m);
  const markdown = readFileSync(join(root, "AGENTS.md"), "utf8");
  assert.ok(markdown.startsWith(outside));
  assert.match(markdown, /\| `scout` \| `cursor\/composer-2\.5` \|/);
  assert.doesNotMatch(markdown, /cursor\/old/);
  const settings = readFileSync(join(root, "settings.json"), "utf8");
  assert.match(settings, /cursor\/composer-2\.5/);
});
