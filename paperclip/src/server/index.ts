import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execute, deliverToParkedPane } from "./execute.ts";
import { defaultAgentDir, skillSnapshot, syncSkillSelection } from "../pi-skills.ts";
import { listPersonas } from "../personas.ts";
import { readEnabledModels } from "../scope.ts";
import { testEnvironment } from "./test.ts";

export const type = "ultimate_pi";
export const label = "Ultimate PI";

export const agentConfigurationDoc = `# ultimate_pi
Hire Ultimate PI. Claude, Codex, and Cursor run inside Pi, not as separate Paperclip adapters.
persona: orchestrator | scout | worker | planner | researcher | qa_tester | reviewer
thinking: off | minimal | low | medium | high | xhigh
runLimitSec: 0 waits until Pi exits
env: passed into the tmux session
Instructions bundle is appended to the persona prompt.
agentDir: defaults to ~/.pi/agent
Models must be in settings.json enabledModels.
Runs inside tmux session paperclip-<agentId>.
`;

function templatesDir(): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  for (const candidate of [join(here, "../../templates/agents"), join(here, "../../../templates/agents")]) {
    if (existsSync(candidate)) return candidate;
  }
  return join(here, "../../templates/agents");
}

export function getConfigSchema() {
  const personas = listPersonas(defaultAgentDir(), templatesDir());
  return {
    fields: [
      {
        key: "persona",
        label: "Persona",
        type: "select",
        options: personas.map((persona) => ({ value: persona.name, label: persona.name })),
        hint: "Role this agent runs. The model and thinking selected here are what the run starts with. The orchestrator still keeps every tool and extension.",
      },
      {
        key: "runLimitSec",
        label: "Run timeout (seconds)",
        type: "number",
        default: 0,
        hint: "0 waits until Pi exits. Any other number stops the tmux session at the limit.",
      },
    ],
  };
}

function agentDirFrom(config: Record<string, unknown>): string {
  return typeof config.agentDir === "string" && config.agentDir.trim() ? config.agentDir.trim() : defaultAgentDir();
}

export function listModels() {
  return readEnabledModels(defaultAgentDir()).map((id) => ({ id, label: id }));
}

export function listSkills(ctx: { config: Record<string, unknown> }) {
  return Promise.resolve(skillSnapshot(agentDirFrom(ctx.config), ctx.config));
}

export function syncSkills(ctx: { config: Record<string, unknown> }, desiredSkills: string[]) {
  return Promise.resolve(syncSkillSelection(agentDirFrom(ctx.config), desiredSkills, ctx.config));
}

export function createServerAdapter() {
  return {
    type,
    label,
    execute,
    testEnvironment,
    listModels,
    listSkills,
    syncSkills,
    getConfigSchema,
    agentConfigurationDoc,
    supportsLocalAgentJwt: true,
  };
}

export { deliverToParkedPane };
