/**
 * Detect a BMAD v6 project and the per-project agent-system choice.
 * The choice lives in `{root}/.pi/agent-system` as `bmad` or `ultimate-pi`.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

export type AgentSystem = "bmad" | "ultimate-pi";

export type PiRole = "planner" | "worker" | "researcher" | "qa_tester";

export interface BmadPersona {
	skill: string;
	name: string;
	role: string;
	principles: string[];
	piRole: PiRole | null;
}

export interface BmadProject {
	root: string;
	planningArtifacts?: string;
	implementationArtifacts?: string;
	skillsDir?: string;
	personas: BmadPersona[];
}

const PRINCIPLE_CAP = 5;

const MARKERS = [join("_bmad", "bmm", "config.yaml"), join("_bmad", "_config", "manifest.yaml")];

const EXPLICIT_SWITCH =
	/\b(?:switch(?:\s+this\s+project)?\s+to|use)\s+(?:the\s+)?(?:bmad|ultimate\s*pi)\s+agents(?:\s+for\s+this\s+project)?\b/i;

export function isExplicitAgentSystemSwitch(prompt: string): boolean {
	return EXPLICIT_SWITCH.test(prompt);
}

export function agentSystemPath(root: string): string {
	return join(root, ".pi", "agent-system");
}

export function readAgentSystem(root: string): AgentSystem | null {
	const path = agentSystemPath(root);
	if (!existsSync(path)) return null;
	const text = readFileSync(path, "utf8").trim();
	if (text === "bmad" || text === "ultimate-pi") return text;
	return null;
}

export function writeAgentSystem(root: string, choice: string): AgentSystem {
	if (choice !== "bmad" && choice !== "ultimate-pi") {
		throw new Error(`agent system must be bmad or ultimate-pi, got ${choice}`);
	}
	const path = agentSystemPath(root);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${choice}\n`);
	return choice;
}

export function personaPiRole(skill: string): PiRole | null {
	const id = skill.replace(/^bmad-agent-/, "");
	if (id === "pm" || id === "architect" || id === "ux-designer" || id === "sm") return "planner";
	if (id === "dev") return "worker";
	if (id === "analyst") return "researcher";
	if (id === "qa" || id === "tea") return "qa_tester";
	return null;
}

function hasGraftSegment(dir: string): boolean {
	return dir.split(sep).includes("graft");
}

function hasMarker(dir: string): boolean {
	return MARKERS.some((rel) => existsSync(join(dir, rel)));
}

export function findBmadRoot(cwd: string): string | null {
	let dir = resolve(cwd);
	while (true) {
		if (!hasGraftSegment(dir) && hasMarker(dir)) return dir;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

function agentSection(toml: string): string {
	const match = toml.match(/^\[agent\]\s*$/m);
	if (!match || match.index === undefined) return "";
	const rest = toml.slice(match.index + match[0].length);
	const end = rest.search(/\n\[[^[\n]/);
	return end === -1 ? rest : rest.slice(0, end);
}

function unquote(value: string): string {
	return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function scalar(section: string, key: string): string {
	const match = section.match(new RegExp(`^${key}\\s*=\\s*"((?:\\\\.|[^"\\\\])*)"`, "m"));
	return match ? unquote(match[1]) : "";
}

function principlesOf(section: string): string[] {
	const match = section.match(/principles\s*=\s*\[([\s\S]*?)\]/);
	if (!match) return [];
	const out: string[] = [];
	const re = /"((?:\\.|[^"\\])*)"/g;
	let found: RegExpExecArray | null;
	while ((found = re.exec(match[1]))) out.push(unquote(found[1]));
	return out;
}

function readIfExists(path: string): string | null {
	if (!existsSync(path)) return null;
	return readFileSync(path, "utf8");
}

function personaFromSkill(root: string, skill: string): BmadPersona {
	const files = [
		readIfExists(join(root, ".agents", "skills", skill, "customize.toml")),
		readIfExists(join(root, "_bmad", "custom", `${skill}.toml`)),
		readIfExists(join(root, "_bmad", "custom", `${skill}.user.toml`)),
	].filter((text): text is string => text !== null);

	let name = "";
	let role = "";
	const principles: string[] = [];
	for (const text of files) {
		const section = agentSection(text);
		const nextName = scalar(section, "name");
		const nextRole = scalar(section, "role");
		if (nextName) name = nextName;
		if (nextRole) role = nextRole;
		principles.push(...principlesOf(section));
	}
	return {
		skill,
		name,
		role,
		principles: principles.slice(0, PRINCIPLE_CAP),
		piRole: personaPiRole(skill),
	};
}

function yamlScalar(text: string, key: string): string | undefined {
	const match = text.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"));
	if (!match) return undefined;
	return match[1].replace(/^["']|["']$/g, "");
}

export function detectBmadProject(cwd: string): BmadProject | null {
	const root = findBmadRoot(cwd);
	if (!root) return null;
	const skillsDir = join(root, ".agents", "skills");
	const personas: BmadPersona[] = [];
	if (existsSync(skillsDir)) {
		for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
			if (!entry.isDirectory() || !entry.name.startsWith("bmad-agent-")) continue;
			personas.push(personaFromSkill(root, entry.name));
		}
		personas.sort((a, b) => a.skill.localeCompare(b.skill));
	}
	const configPath = join(root, "_bmad", "bmm", "config.yaml");
	const config = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
	return {
		root,
		planningArtifacts: yamlScalar(config, "planning_artifacts"),
		implementationArtifacts: yamlScalar(config, "implementation_artifacts"),
		skillsDir: existsSync(skillsDir) ? skillsDir : undefined,
		personas,
	};
}

const ROLE_ORDER: PiRole[] = ["planner", "worker", "researcher", "qa_tester"];

export function formatUltimatePiCard(project: BmadProject): string {
	const lines = [
		"This project has BMAD installed. Agent system: Ultimate PI.",
		"Route with jev_triage. Paste only the matching role slice into the child brief.",
		"The planner brief gets one planning persona: architecture or technical design uses the architect, UX or interface or flow uses the ux-designer, a PRD or requirements uses the pm, stories or a sprint uses the sm. Leave the other planning personas out of that brief.",
	];
	for (const role of ROLE_ORDER) {
		for (const person of project.personas.filter((item) => item.piRole === role)) {
			const label = person.name || person.skill;
			const principles = person.principles.map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean);
			const detail = [person.role, principles.length ? `Principles: ${principles.join("; ")}` : ""]
				.filter(Boolean)
				.join(" ");
			lines.push(detail ? `${role}: ${label} — ${detail}` : `${role}: ${label}`);
		}
	}
	if (project.planningArtifacts) lines.push(`planning_artifacts: ${project.planningArtifacts}`);
	if (project.implementationArtifacts) lines.push(`implementation_artifacts: ${project.implementationArtifacts}`);
	lines.push(
		"Do not run party mode, bmad-help as a router, bmad-dev-auto, bmad-quick-dev, bmad-loop, a persona greeting, or stay-in-character.",
		"The planner still writes .pi/plans/ and calls handoff_spec. If the brief is a story, the worker uses the story file under implementation_artifacts. When that story names files, the parent does not spawn a scout.",
		"Code review stays the parent checkpoint after the worker.",
		"Do not change .pi/agent-system unless the user explicitly asks to switch the agent system for this project.",
	);
	return lines.join("\n");
}

export function formatBmadModeCard(project: BmadProject): string {
	const lines = [
		"This project uses the BMAD agent skills.",
		"Follow the persona the user named, or bmad-help when they ask what is next.",
		"Do not remap that work onto scout, worker, planner, or qa_tester.",
		"Bash-guard, edit-guard, and /jobs stay available.",
	];
	if (project.planningArtifacts) lines.push(`planning_artifacts: ${project.planningArtifacts}`);
	if (project.implementationArtifacts) lines.push(`implementation_artifacts: ${project.implementationArtifacts}`);
	lines.push("Do not change .pi/agent-system unless the user explicitly asks to switch the agent system for this project.");
	return lines.join("\n");
}
