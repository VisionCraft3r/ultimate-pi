import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadInstalledState } from "../installer/load-installed-state.mjs";

async function makeTempDir() {
  return mkdtemp(path.join(tmpdir(), "ultimate-pi-load-state-"));
}

function agentMarkdown(name, provider, model, thinking) {
  const thinkingLine = thinking ? `thinking: ${thinking}\n` : "";
  return `---\nname: ${name}\nmodel: ${provider}/${model}\n${thinkingLine}---\n\n<!-- managed-by: ultimate-pi -->\n`;
}

test("loadInstalledState reads packages, fallback chains, and five agent frontmatters", async () => {
  const dir = await makeTempDir();
  try {
    const packages = [
      "git:github.com/VisionCraft3r/ultimate-pi",
      "npm:pi-lens",
      "git:github.com/amosblomqvist/pi-interactive-subagents",
    ];
    const fallbacks = {
      anthropic: [{ provider: "openrouter", id: "anthropic/claude-sonnet-4.6" }],
      cursor: [
        { provider: "anthropic", id: "claude-sonnet-4.6" },
        { provider: "openrouter", id: "openai/gpt-4.1-mini" },
      ],
    };
    const agentFallbacks = {
      worker: [{ provider: "openrouter", id: "deepseek/deepseek-chat" }],
      planner: [{ provider: "cursor", id: "grok-4.5" }],
    };
    const assignments: Record<string, { provider: string; model: string; thinking?: string }> = {
      scout: { provider: "cursor", model: "composer-1.5" },
      worker: { provider: "cursor", model: "grok-4.5", thinking: "high" },
      planner: { provider: "anthropic", model: "claude-opus-4.6" },
      researcher: { provider: "openai-codex", model: "gpt-5.4" },
      qa_tester: { provider: "openrouter", model: "openai/gpt-4.1-mini" },
    };

    await writeFile(
      path.join(dir, "settings.json"),
      JSON.stringify({ packages, theme: "unrelated" }, null, 2),
    );
    await writeFile(
      path.join(dir, "model-agents.json"),
      JSON.stringify({ keep: "unrelated-key", fallbacks, agentFallbacks }, null, 2),
    );
    await mkdir(path.join(dir, "agents"), { recursive: true });
    for (const [name, row] of Object.entries(assignments)) {
      await writeFile(
        path.join(dir, "agents", `${name}.md`),
        agentMarkdown(name, row.provider, row.model, row.thinking),
      );
    }

    const loaded = await loadInstalledState(dir);

    assert.deepEqual(loaded.packages, packages);
    assert.deepEqual(loaded.providerChains, fallbacks);
    assert.deepEqual(loaded.agentFallbacks, agentFallbacks);
    assert.deepEqual(loaded.agentAssignments, assignments);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadInstalledState throws on a malformed existing model-agents.json", async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(path.join(dir, "model-agents.json"), "{ this is not json\n");
    await assert.rejects(
      () => loadInstalledState(dir),
      /model-agents\.json is not valid JSON/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
