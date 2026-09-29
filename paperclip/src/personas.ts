import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ORCHESTRATOR = "orchestrator";
export const SHIPPED_PERSONAS = ["scout", "worker", "planner", "researcher", "qa_tester", "reviewer"] as const;

export type PersonaFrontmatter = {
  name: string;
  description: string;
  model: string;
  thinking: string;
  tools: string;
  body: string;
  source: "template" | "installed" | "orchestrator";
  interactive: boolean;
};

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function field(block: string, key: string): string {
  const match = block.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim() ?? "";
}

export function parsePersonaMarkdown(name: string, markdown: string, source: PersonaFrontmatter["source"]): PersonaFrontmatter {
  const match = markdown.match(FRONTMATTER);
  const block = match?.[1] ?? "";
  const body = match ? markdown.slice(match[0].length).trim() : markdown.trim();
  return {
    name: field(block, "name") || name,
    description: field(block, "description"),
    model: field(block, "model"),
    thinking: field(block, "thinking"),
    tools: field(block, "tools"),
    body,
    source,
    interactive: field(block, "interactive") === "true" || field(block, "auto-exit") === "false",
  };
}

export function orchestratorPersona(): PersonaFrontmatter {
  return {
    name: ORCHESTRATOR,
    description: "Ultimate PI orchestrator — JEV triage, then tmux fan-out to the role personas",
    model: "",
    thinking: "",
    tools: "",
    body: "",
    source: "orchestrator",
    interactive: false,
  };
}

function readNames(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.slice(0, -3));
  } catch {
    return [];
  }
}

export function listPersonas(agentDir: string, templatesDir: string): PersonaFrontmatter[] {
  const installedDir = join(agentDir, "agents");
  const names = new Set<string>([...SHIPPED_PERSONAS, ...readNames(installedDir)]);
  const personas = [orchestratorPersona()];
  for (const name of [...names].sort()) {
    const installedPath = join(installedDir, `${name}.md`);
    const templatePath = join(templatesDir, `${name}.md`);
    let markdown: string | undefined;
    let source: PersonaFrontmatter["source"] = "installed";
    try {
      markdown = readFileSync(installedPath, "utf8");
    } catch {
      try {
        markdown = readFileSync(templatePath, "utf8");
        source = "template";
      } catch {
        markdown = undefined;
      }
    }
    if (!markdown) continue;
    personas.push(parsePersonaMarkdown(name, markdown, source));
  }
  return personas;
}

export function personaByName(personas: readonly PersonaFrontmatter[], name: string): PersonaFrontmatter | undefined {
  return personas.find((persona) => persona.name === name);
}
