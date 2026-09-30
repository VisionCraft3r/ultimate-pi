/**
 * Grantable child tools and the profile lint. The managed routing block and
 * doctor both use this list. A profile that omits tools: inherits everything.
 */

export const GRANTABLE_TOOLS = [
	"read",
	"write",
	"edit",
	"bash",
	"grep",
	"find",
	"ls",
	"web_search",
	"web_fetch",
	"safe_bash",
	"video_extract",
	"youtube_search",
	"google_image_search",
	"jev_sentinel",
	"handoff_spec",
	"ask_user_question",
	"browser_goto",
	"browser_click",
	"browser_eval",
	"browser_fill",
	"browser_screenshot",
	"browser_console",
	"browser_network",
] as const;

const GRANTABLE = new Set<string>(GRANTABLE_TOOLS);

export const KNOWN_FRONTMATTER_KEYS = new Set([
	"name",
	"description",
	"model",
	"thinking",
	"tools",
	"subagent_agents",
	"system-prompt",
	"auto-exit",
	"interactive",
]);

const REVIEWER_BANNED = ["write", "edit", "bash"];

export function lintAgentProfile(text: string, file = "agent"): string[] {
	const errors: string[] = [];
	if (!text.startsWith("---\n")) {
		errors.push(`${file}: missing frontmatter`);
		return errors;
	}
	const end = text.indexOf("\n---", 4);
	if (end < 0) {
		errors.push(`${file}: frontmatter does not close`);
		return errors;
	}
	const frontmatter = text.slice(4, end);
	let name = "";
	let tools = "";
	let sawTools = false;
	for (const line of frontmatter.split("\n")) {
		if (!line.trim() || line.trim().startsWith("#")) continue;
		const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!match) {
			errors.push(`${file}: frontmatter line is not key: value (${line})`);
			continue;
		}
		const key = match[1];
		const value = match[2].trim();
		if (!KNOWN_FRONTMATTER_KEYS.has(key)) errors.push(`${file}: unknown frontmatter key ${key}`);
		if (key === "name") name = value;
		if (key === "tools") {
			sawTools = true;
			tools = value;
		}
	}
	if (!sawTools) {
		errors.push(`${file}: tools: is required so the child does not inherit the full toolset`);
		return errors;
	}
	if (tools.startsWith("[") || tools.endsWith("]")) {
		errors.push(`${file}: tools: must be a comma-separated line, not a YAML array`);
	}
	const names = tools
		.replace(/^\[/, "")
		.replace(/\]$/, "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
	for (const tool of names) {
		if (!GRANTABLE.has(tool)) errors.push(`${file}: unknown tool ${tool}`);
	}
	if (name === "reviewer") {
		for (const banned of REVIEWER_BANNED) {
			if (names.includes(banned)) errors.push(`${file}: reviewer cannot have ${banned}`);
		}
	}
	return errors;
}
