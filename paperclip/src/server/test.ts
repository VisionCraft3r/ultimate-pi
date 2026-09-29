import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { listPersonas } from "../personas.ts";
import { readEnabledModels } from "../scope.ts";
import { fileURLToPath } from "node:url";

export type EnvCheck = { level: "info" | "warn" | "error"; message: string; code: string };

function templatesDir(): string {
  return fileURLToPath(new URL("../../../templates/agents/", import.meta.url));
}

function onPath(command: string): boolean {
  const result = spawnSync("sh", ["-c", `command -v ${command}`], { encoding: "utf8" });
  return result.status === 0 && Boolean(result.stdout.trim());
}

export function testEnvironment(input: {
  adapterType?: string;
  config?: Record<string, unknown>;
} = {}): { adapterType: string; status: "pass" | "warn" | "fail"; checks: EnvCheck[]; testedAt: string } {
  const agentDir = typeof input.config?.agentDir === "string" && input.config.agentDir
    ? input.config.agentDir
    : join(process.env.HOME ?? "", ".pi", "agent");
  const checks: EnvCheck[] = [];
  const nodeMajor = Number(process.versions.node.split(".")[0] ?? 0);
  const nodeMinor = Number(process.versions.node.split(".")[1] ?? 0);
  checks.push(
    nodeMajor > 24 || (nodeMajor === 24 && nodeMinor >= 11)
      ? { level: "info", message: `Node ${process.versions.node}`, code: "node" }
      : { level: "error", message: `Node ${process.versions.node} is below Paperclip's 24.11`, code: "node" },
  );
  checks.push(onPath("pi")
    ? { level: "info", message: "pi is on PATH", code: "pi" }
    : { level: "error", message: "pi is not on PATH", code: "pi" });
  checks.push(onPath("tmux")
    ? { level: "info", message: "tmux is on PATH", code: "tmux" }
    : { level: "error", message: "tmux is not on PATH", code: "tmux" });
  for (const file of ["auth.json", "settings.json", "AGENTS.md"]) {
    checks.push(existsSync(join(agentDir, file))
      ? { level: "info", message: `${file} present`, code: file }
      : { level: "error", message: `${agentDir}/${file} is missing`, code: file });
  }
  const personas = listPersonas(agentDir, templatesDir()).filter((persona) => persona.name !== "orchestrator");
  checks.push(personas.length > 0
    ? { level: "info", message: `${personas.length} personas`, code: "personas" }
    : { level: "error", message: "no persona files", code: "personas" });
  const scoped = readEnabledModels(agentDir);
  checks.push(scoped.length > 0
    ? { level: "info", message: `${scoped.length} scoped models`, code: "scope" }
    : { level: "warn", message: "enabledModels is empty", code: "scope" });
  const status = checks.some((check) => check.level === "error")
    ? "fail"
    : checks.some((check) => check.level === "warn")
      ? "warn"
      : "pass";
  return {
    adapterType: input.adapterType ?? "ultimate_pi",
    status,
    checks,
    testedAt: new Date().toISOString(),
  };
}
