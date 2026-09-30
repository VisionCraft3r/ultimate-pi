import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { GRANTABLE_TOOLS, lintAgentProfile } from "../lib/agent-profile.ts";

const root = join(import.meta.dirname, "..");

test("shipped agent templates pass the profile lint", () => {
	const dir = join(root, "templates", "agents");
	const files = readdirSync(dir).filter((name) => name.endsWith(".md"));
	assert.ok(files.length >= 6);
	const errors = files.flatMap((name) => lintAgentProfile(readFileSync(join(dir, name), "utf8"), name));
	assert.deepEqual(errors, []);
});

test("the routing block lists the same grantable tools", () => {
	const template = readFileSync(join(root, "templates", "AGENTS.md.tmpl"), "utf8");
	for (const tool of GRANTABLE_TOOLS) {
		assert.match(template, new RegExp(`\`${tool}\``), tool);
	}
});

test("a YAML tools array and a missing tools line are rejected", () => {
	const array = "---\nname: worker\ntools: [read, write]\n---\n";
	assert.match(lintAgentProfile(array, "worker.md").join("\n"), /YAML array/);
	const omitted = "---\nname: worker\n---\n";
	assert.match(lintAgentProfile(omitted, "worker.md").join("\n"), /tools: is required/);
	const reviewer = "---\nname: reviewer\ntools: read, bash\n---\n";
	assert.match(lintAgentProfile(reviewer, "reviewer.md").join("\n"), /reviewer cannot have bash/);
});
