import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  mergeSettings,
  applyAgentsMdBlock,
  applySettings,
} from "../installer/settings.mjs";

async function makeTempDir() {
  return mkdtemp(path.join(tmpdir(), "ultimate-pi-settings-test-"));
}

test("mergeSettings preserves unrelated existing keys", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(
      path.join(dir, "settings.json"),
      JSON.stringify({ theme: "dark", enabledModels: ["anthropic/claude-x"] }, null, 2),
    );
    await mergeSettings(dir, { packages: ["pi-interactive-subagents"], enabledModels: ["cursor/grok"] });
    const next = JSON.parse(await readFile(path.join(dir, "settings.json"), "utf8"));
    assert.equal(next.theme, "dark");
    assert.deepEqual(next.packages, ["pi-interactive-subagents"]);
    assert.deepEqual(
      new Set(next.enabledModels),
      new Set(["anthropic/claude-x", "cursor/grok"]),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mergeSettings creates settings.json when absent", async () => {
  const dir = await makeTempDir();
  try {
    await mergeSettings(dir, { packages: ["a"] });
    const next = JSON.parse(await readFile(path.join(dir, "settings.json"), "utf8"));
    assert.deepEqual(next.packages, ["a"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("applyAgentsMdBlock creates markers when file has none, preserving prior content", async () => {
  const dir = await makeTempDir();
  const templatePath = path.join(dir, "AGENTS.md.tmpl");
  await writeFile(templatePath, "<!-- ultimate-pi:begin -->\nHello {{name}}\n<!-- ultimate-pi:end -->\n");
  try {
    await writeFile(path.join(dir, "AGENTS.md"), "# My notes\n\nDo not touch this.\n");
    await applyAgentsMdBlock(dir, templatePath, { name: "World" });
    const text = await readFile(path.join(dir, "AGENTS.md"), "utf8");
    assert.match(text, /Do not touch this\./);
    assert.match(text, /Hello World/);
    assert.match(text, /<!-- ultimate-pi:begin -->/);
    assert.match(text, /<!-- ultimate-pi:end -->/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("applyAgentsMdBlock is idempotent: re-running replaces, does not duplicate", async () => {
  const dir = await makeTempDir();
  const templatePath = path.join(dir, "AGENTS.md.tmpl");
  await writeFile(templatePath, "<!-- ultimate-pi:begin -->\nversion: {{name}}\n<!-- ultimate-pi:end -->\n");
  try {
    await applyAgentsMdBlock(dir, templatePath, { name: "one" });
    await applyAgentsMdBlock(dir, templatePath, { name: "two" });
    const text = await readFile(path.join(dir, "AGENTS.md"), "utf8");
    const beginCount = (text.match(/<!-- ultimate-pi:begin -->/g) ?? []).length;
    const endCount = (text.match(/<!-- ultimate-pi:end -->/g) ?? []).length;
    assert.equal(beginCount, 1);
    assert.equal(endCount, 1);
    assert.match(text, /version: two/);
    assert.doesNotMatch(text, /version: one/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("applySettings persists providerChains and agentFallbacks into model-agents.json", async () => {
  const dir = await makeTempDir();
  try {
    const agentAssignments = {
      scout: { provider: "cursor", model: "composer-1.5" },
      worker: { provider: "cursor", model: "grok-4.5" },
      planner: { provider: "anthropic", model: "claude-opus-4.6" },
      researcher: { provider: "openai-codex", model: "gpt-5.4" },
      qa_tester: { provider: "openrouter", model: "openai/gpt-4.1-mini" },
    };
    const providerChains = {
      anthropic: [{ provider: "openai-codex", id: "gpt-5.4" }],
      cursor: [
        { provider: "anthropic", id: "claude-sonnet-4.6" },
        { provider: "openrouter", id: "openai/gpt-4.1-mini" },
      ],
    };
    const agentFallbacks = {
      worker: [{ provider: "openrouter", id: "deepseek/deepseek-chat" }],
      planner: [{ provider: "cursor", id: "grok-4.5" }],
    };

    await applySettings(
      { agentDir: dir },
      { agentAssignments, providerChains, agentFallbacks, packages: [] },
    );

    const written = JSON.parse(await readFile(path.join(dir, "model-agents.json"), "utf8"));
    assert.deepEqual(written.fallbacks, providerChains);
    assert.deepEqual(written.agentFallbacks, agentFallbacks);

    const settings = JSON.parse(await readFile(path.join(dir, "settings.json"), "utf8"));
    const enabled = new Set(settings.enabledModels);
    const expectedEnabled = [
      "cursor/composer-1.5",
      "cursor/grok-4.5",
      "anthropic/claude-opus-4.6",
      "openai-codex/gpt-5.4",
      "openrouter/openai/gpt-4.1-mini",
      "anthropic/claude-sonnet-4.6",
      "openrouter/deepseek/deepseek-chat",
    ];
    for (const ref of expectedEnabled) {
      assert.ok(enabled.has(ref), `settings.json.enabledModels missing ${ref}`);
    }

    for (const [name, assignment] of Object.entries(agentAssignments)) {
      const body = await readFile(path.join(dir, "agents", `${name}.md`), "utf8");
      const expectedModel = `${assignment.provider}/${assignment.model}`;
      const modelLine = body.split("\n").find((line) => line.startsWith("model:"));
      assert.equal(modelLine?.trim(), `model: ${expectedModel}`, `${name}.md model frontmatter`);
      assert.match(modelLine ?? "", /^model:\s+\S+\/\S+$/, `${name}.md model: must be provider/id`);
      assert.doesNotMatch(body, /\{\{[^}]+\}\}/, `${name}.md still has unresolved {{...}} placeholders`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("applySettings backs up preexisting settings, model-agents, AGENTS.md, and managed worker.md", async () => {
  const dir = await makeTempDir();
  try {
    const originals = {
      "settings.json": '{"theme":"backup-probe","enabledModels":["probe/old"]}\n',
      "model-agents.json": '{"keep":"original-key","fallbacks":{"probe":[{"provider":"probe","id":"old"}]}}\n',
      "AGENTS.md": "# preexisting AGENTS.md original bytes\n",
      "agents/worker.md":
        "---\nname: worker\nmodel: probe/old\n---\n\n<!-- managed-by: ultimate-pi -->\noriginal worker body\n",
    };
    await mkdir(path.join(dir, "agents"), { recursive: true });
    for (const [rel, body] of Object.entries(originals)) {
      await writeFile(path.join(dir, rel), body);
    }

    const assignment = { provider: "anthropic", model: "claude-sonnet-4.6" };
    const agentAssignments = {
      scout: assignment,
      worker: assignment,
      planner: assignment,
      researcher: assignment,
      qa_tester: assignment,
    };

    await applySettings({ agentDir: dir }, { agentAssignments, packages: [] });

    const sessions = (await readdir(path.join(dir, "backups"))).filter((name) =>
      name.startsWith("ultimate-pi-"),
    );
    assert.equal(sessions.length, 1, `expected one backup session, got ${sessions.join(",")}`);
    const sessionDir = path.join(dir, "backups", sessions[0]);

    for (const [rel, original] of Object.entries(originals)) {
      const backed = await readFile(path.join(sessionDir, rel));
      assert.deepEqual(backed, Buffer.from(original), `backup of ${rel} must preserve original bytes`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
