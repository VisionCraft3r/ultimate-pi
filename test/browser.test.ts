import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveBrowserProfileDir } from "../extensions/browser/index.ts";

test("browser profile dir uses PI_CODING_AGENT_DIR via getAgentDir", () => {
	const prevDir = process.env.PI_CODING_AGENT_DIR;
	const prevProfile = process.env.PI_BROWSER_PROFILE;
	delete process.env.PI_BROWSER_PROFILE;
	process.env.PI_CODING_AGENT_DIR = "/tmp/upi-browser-agent-dir";
	try {
		assert.equal(
			resolveBrowserProfileDir(),
			"/tmp/upi-browser-agent-dir/extensions/browser/.profile",
		);
	} finally {
		if (prevDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = prevDir;
		if (prevProfile === undefined) delete process.env.PI_BROWSER_PROFILE;
		else process.env.PI_BROWSER_PROFILE = prevProfile;
	}
});

test("PI_BROWSER_PROFILE overrides the agent-dir default", () => {
	const prev = process.env.PI_BROWSER_PROFILE;
	process.env.PI_BROWSER_PROFILE = "/tmp/custom-upi-browser-profile";
	try {
		assert.equal(resolveBrowserProfileDir(), "/tmp/custom-upi-browser-profile");
	} finally {
		if (prev === undefined) delete process.env.PI_BROWSER_PROFILE;
		else process.env.PI_BROWSER_PROFILE = prev;
	}
});
