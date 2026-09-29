import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	detectBmadProject,
	formatUltimatePiCard,
	isExplicitAgentSystemSwitch,
	readAgentSystem,
	writeAgentSystem,
} from "../lib/bmad-project.ts";

const DEV_TOML = `[agent]
name = "Amelia"
role = "Implement approved stories."
principles = [
  "One.",
  "Two.",
  "Three.",
  "Four.",
]
`;

const DEV_CUSTOM = `[agent]
principles = [
  "Five.",
  "Six should be dropped.",
]
`;

const ARCHITECT_TOML = `[agent]
name = "Winston"
role = "Turn requirements into architecture."
principles = [
  "Boring technology.",
]
`;

const PM_TOML = `[agent]
name = "John"
role = "Own the PRD."
principles = [
  "Smallest spec that ships.",
]
`;

const WRITER_TOML = `[agent]
name = "Paige"
role = "Write the docs."
principles = [
  "Clarity.",
]
`;

async function fixture(): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), "ultimate-pi-bmad-"));
	await mkdir(path.join(root, "_bmad", "bmm"), { recursive: true });
	await mkdir(path.join(root, "_bmad", "_config"), { recursive: true });
	await mkdir(path.join(root, "_bmad", "custom"), { recursive: true });
	await writeFile(
		path.join(root, "_bmad", "bmm", "config.yaml"),
		"planning_artifacts: _bmad-output/planning-artifacts\nimplementation_artifacts: _bmad-output/implementation-artifacts\n",
	);
	await writeFile(path.join(root, "_bmad", "_config", "manifest.yaml"), "modules: []\n");
	await writeFile(path.join(root, "_bmad", "custom", "bmad-agent-dev.toml"), DEV_CUSTOM);
	for (const [skill, body] of [
		["bmad-agent-dev", DEV_TOML],
		["bmad-agent-architect", ARCHITECT_TOML],
		["bmad-agent-pm", PM_TOML],
		["bmad-agent-tech-writer", WRITER_TOML],
	] as const) {
		const dir = path.join(root, ".agents", "skills", skill);
		await mkdir(dir, { recursive: true });
		await writeFile(path.join(dir, "customize.toml"), body);
	}
	const graft = path.join(root, "graft");
	await mkdir(path.join(graft, "_bmad", "bmm"), { recursive: true });
	await writeFile(path.join(graft, "_bmad", "bmm", "config.yaml"), "planning_artifacts: graft-should-not-win\n");
	return root;
}

test("detects a BMAD project, skips graft, and caps merged principles", async () => {
	const root = await fixture();
	try {
		const fromGraft = detectBmadProject(path.join(root, "graft", "nested"));
		assert.equal(fromGraft?.root, root);
		assert.notEqual(fromGraft?.planningArtifacts, "graft-should-not-win");
		const found = detectBmadProject(path.join(root, "src"));
		assert.ok(found);
		assert.equal(found.root, root);
		assert.equal(found.planningArtifacts, "_bmad-output/planning-artifacts");
		assert.equal(found.implementationArtifacts, "_bmad-output/implementation-artifacts");
		const dev = found.personas.find((persona) => persona.skill === "bmad-agent-dev");
		const architect = found.personas.find((persona) => persona.skill === "bmad-agent-architect");
		const pm = found.personas.find((persona) => persona.skill === "bmad-agent-pm");
		const writer = found.personas.find((persona) => persona.skill === "bmad-agent-tech-writer");
		assert.equal(dev?.piRole, "worker");
		assert.equal(architect?.piRole, "planner");
		assert.equal(pm?.piRole, "planner");
		assert.equal(writer?.piRole, null);
		assert.deepEqual(dev?.principles, ["One.", "Two.", "Three.", "Four.", "Five."]);
		const card = formatUltimatePiCard(found);
		assert.match(card, /planner: Winston/);
		assert.match(card, /planner: John/);
		assert.match(card, /worker: Amelia/);
		assert.match(card, /planner brief gets one planning persona/);
		assert.match(card, /does not spawn a scout/);
		assert.doesNotMatch(card, /Paige/);
		assert.doesNotMatch(card, /Six should be dropped/);

		const only = await mkdtemp(path.join(tmpdir(), "ultimate-pi-graft-only-"));
		try {
			const graft = path.join(only, "graft");
			await mkdir(path.join(graft, "_bmad", "bmm"), { recursive: true });
			await writeFile(path.join(graft, "_bmad", "bmm", "config.yaml"), "planning_artifacts: graft-only\n");
			assert.equal(detectBmadProject(graft), null);
		} finally {
			await rm(only, { recursive: true, force: true });
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a missing or unknown agent-system file means ask, and only the two tokens are stored", async () => {
	const root = await fixture();
	try {
		assert.equal(readAgentSystem(root), null);
		await mkdir(path.join(root, ".pi"), { recursive: true });
		await writeFile(path.join(root, ".pi", "agent-system"), "party-mode\n");
		assert.equal(readAgentSystem(root), null);
		assert.equal(writeAgentSystem(root, "bmad"), "bmad");
		assert.equal(readAgentSystem(root), "bmad");
		assert.equal(writeAgentSystem(root, "ultimate-pi"), "ultimate-pi");
		assert.equal(readAgentSystem(root), "ultimate-pi");
		assert.throws(() => writeAgentSystem(root, "party-mode"), /bmad or ultimate-pi/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("only an explicit agent-system request counts as a switch", () => {
	assert.equal(isExplicitAgentSystemSwitch("switch this project to BMAD agents"), true);
	assert.equal(isExplicitAgentSystemSwitch("use Ultimate PI agents for this project"), true);
	assert.equal(isExplicitAgentSystemSwitch("please use the BMAD agents"), true);
	assert.equal(isExplicitAgentSystemSwitch("implement the bmad bridge and mention the agents"), false);
	assert.equal(isExplicitAgentSystemSwitch("fix the login bug"), false);
});
