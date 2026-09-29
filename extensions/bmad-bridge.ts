/**
 * On a BMAD project, ask once which agent system to use and remember it in
 * `.pi/agent-system`. Parent only: children launch with --no-extensions.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	detectBmadProject,
	formatBmadModeCard,
	formatUltimatePiCard,
	isExplicitAgentSystemSwitch,
	readAgentSystem,
	writeAgentSystem,
	type AgentSystem,
} from "../lib/bmad-project.ts";
import {
	UPDATE_NOTICE,
	decideBmadUpdate,
	diffCustomHashes,
	hashCustomTree,
	isExplicitBmadUpdateRequest,
	lookupLatestBmad,
	runQuickUpdate,
	writeDeclinedUpdate,
} from "../lib/bmad-update.ts";

const BMAD_LABEL = "BMAD agents";
const PI_LABEL = "Ultimate PI agents";
const UPDATE_LABEL = "Update BMAD";
const KEEP_LABEL = "Keep this version";

function choiceFromLabel(label: string | undefined): AgentSystem | null {
	if (label === BMAD_LABEL) return "bmad";
	if (label === PI_LABEL) return "ultimate-pi";
	return null;
}

async function offerBmadUpdate(ctx: ExtensionContext, root: string, force: boolean): Promise<void> {
	const latest = await lookupLatestBmad();
	const decision = decideBmadUpdate({ root, latest, force });
	if (decision.kind === "manual") {
		ctx.ui.notify("This BMAD install is not v6. A major migration is manual. Quick update was not run.", "warning");
		return;
	}
	if (decision.kind === "unknown") {
		ctx.ui.notify("Could not check the latest BMAD version. Continuing on the installed copy.", "warning");
		return;
	}
	if (decision.kind !== "offer") return;
	ctx.ui.notify(UPDATE_NOTICE, "info");
	const picked = await ctx.ui.select(
		`BMAD ${decision.installed} is older than ${decision.latest}. Update with quick-update?`,
		[UPDATE_LABEL, KEEP_LABEL],
	);
	if (picked !== UPDATE_LABEL) {
		if (picked === KEEP_LABEL) writeDeclinedUpdate(root, decision.latest);
		return;
	}
	const before = hashCustomTree(root);
	const result = await runQuickUpdate(root);
	if (result.code !== 0) {
		ctx.ui.notify("BMAD quick update did not finish. This project stays on the installed copy.", "warning");
		return;
	}
	const changed = diffCustomHashes(before, hashCustomTree(root));
	if (changed.length > 0) {
		ctx.ui.notify(
			`Quick update changed _bmad/custom (${changed.join(", ")}). Not treating that as success. Installed skills may already have changed.`,
			"warning",
		);
		return;
	}
	ctx.ui.notify("BMAD quick update finished. _bmad/custom/ is unchanged.", "info");
}

async function promptAndStore(ctx: ExtensionContext, root: string): Promise<void> {
	const picked = await ctx.ui.select("Which agent system should this project use?", [BMAD_LABEL, PI_LABEL]);
	const choice = choiceFromLabel(picked);
	if (!choice) return;
	writeAgentSystem(root, choice);
	ctx.ui.notify(`This project uses ${picked}.`, "info");
	if (choice === "bmad") await offerBmadUpdate(ctx, root, true);
}

export default function (pi: ExtensionAPI) {
	if (process.env.PI_SUBAGENT_AGENT) return;

	pi.registerCommand("agent-system", {
		description: "Choose BMAD agents or Ultimate PI agents for this project",
		handler: async (_args, ctx) => {
			const project = detectBmadProject(ctx.cwd);
			if (!project) {
				ctx.ui.notify("This project does not have BMAD installed.", "warning");
				return;
			}
			await promptAndStore(ctx, project.root);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		const project = detectBmadProject(ctx.cwd);
		if (!project) return;
		const choice = readAgentSystem(project.root);
		if (!choice) {
			await promptAndStore(ctx, project.root);
			return;
		}
		if (choice === "bmad") await offerBmadUpdate(ctx, project.root, false);
	});

	pi.on("resources_discover", (event) => {
		const project = detectBmadProject(event.cwd);
		if (!project?.skillsDir || readAgentSystem(project.root) !== "bmad") return;
		return { skillPaths: [project.skillsDir] };
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const project = detectBmadProject(ctx.cwd);
		if (!project) return;
		if (ctx.hasUI && isExplicitAgentSystemSwitch(event.prompt)) {
			await promptAndStore(ctx, project.root);
		}
		const choice = readAgentSystem(project.root);
		if (ctx.hasUI && choice === "bmad" && isExplicitBmadUpdateRequest(event.prompt)) {
			await offerBmadUpdate(ctx, project.root, true);
		}
		if (!choice) return;
		event.systemPromptOptions.sections.bmad_bridge =
			choice === "bmad" ? formatBmadModeCard(project) : formatUltimatePiCard(project);
	});
}
