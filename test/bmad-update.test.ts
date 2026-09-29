import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	UPDATE_NOTICE,
	compareSemver,
	decideBmadUpdate,
	diffCustomHashes,
	hashCustomTree,
	quickUpdateArgv,
	quickUpdateArgvIfBmad,
	readDeclinedUpdate,
	writeDeclinedUpdate,
} from "../lib/bmad-update.ts";

async function v6Fixture(version: string): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), "ultimate-pi-bmad-update-"));
	await mkdir(path.join(root, "_bmad", "_config"), { recursive: true });
	await mkdir(path.join(root, "_bmad", "custom"), { recursive: true });
	await mkdir(path.join(root, ".agents", "skills", "bmad-agent-dev"), { recursive: true });
	await writeFile(
		path.join(root, "_bmad", "_config", "manifest.yaml"),
		`installation:\n  version: ${version}\nmodules: []\n`,
	);
	await writeFile(path.join(root, ".agents", "skills", "bmad-agent-dev", "customize.toml"), 'name = "Amelia"\n');
	await writeFile(path.join(root, "_bmad", "custom", "bmad-agent-ux-designer.toml"), "principles = []\n");
	return root;
}

test("semver orders 6.9.0 before 6.10.0", () => {
	assert.equal(compareSemver("6.9.0", "6.10.0"), -1);
	assert.equal(compareSemver("6.10.0", "6.10.0"), 0);
	assert.equal(compareSemver("6.10.1", "6.10.0"), 1);
});

test("a current v6 install is not offered an update", async () => {
	const root = await v6Fixture("6.10.0");
	try {
		assert.equal(decideBmadUpdate({ root, latest: "6.10.0" }).kind, "current");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("an older v6 install is offered until that latest version is declined", async () => {
	const root = await v6Fixture("6.5.0");
	try {
		const offered = decideBmadUpdate({ root, latest: "6.10.0" });
		assert.equal(offered.kind, "offer");
		if (offered.kind === "offer") assert.equal(offered.installed, "6.5.0");
		writeDeclinedUpdate(root, "6.10.0");
		assert.equal(readDeclinedUpdate(root), "6.10.0");
		assert.equal(decideBmadUpdate({ root, latest: "6.10.0" }).kind, "declined");
		assert.equal(decideBmadUpdate({ root, latest: "6.10.0", force: true }).kind, "offer");
		assert.equal(decideBmadUpdate({ root, latest: "6.11.0" }).kind, "offer");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("quick-update argv targets the project and Ultimate PI mode does not build it", async () => {
	const root = await v6Fixture("6.5.0");
	try {
		const argv = quickUpdateArgv(root);
		assert.deepEqual(argv, [
			"npx",
			"--yes",
			"bmad-method@latest",
			"install",
			"--yes",
			"--action",
			"quick-update",
			"--directory",
			root,
		]);
		assert.equal(argv.filter((part) => part === "update").length, 0);
		assert.equal(quickUpdateArgvIfBmad("ultimate-pi", root), null);
		assert.equal(quickUpdateArgvIfBmad(null, root), null);
		assert.match(UPDATE_NOTICE, /_bmad\/custom\//);
		assert.match(UPDATE_NOTICE, /customize\.toml/);
		assert.match(UPDATE_NOTICE, /_bmad\/bmm\//);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a custom-file change fails the hash check", async () => {
	const root = await v6Fixture("6.5.0");
	try {
		const before = hashCustomTree(root);
		const custom = path.join(root, "_bmad", "custom", "bmad-agent-ux-designer.toml");
		await writeFile(custom, "principles = ['changed']\n");
		const changed = diffCustomHashes(before, hashCustomTree(root));
		assert.deepEqual(changed, ["bmad-agent-ux-designer.toml"]);
		assert.equal(diffCustomHashes(before, before).length, 0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a non-v6 tree is a manual migration", async () => {
	const root = await v6Fixture("5.2.0");
	try {
		assert.equal(decideBmadUpdate({ root, latest: "6.10.0" }).kind, "manual");
		await rm(path.join(root, ".agents", "skills", "bmad-agent-dev", "customize.toml"));
		await writeFile(
			path.join(root, "_bmad", "_config", "manifest.yaml"),
			"installation:\n  version: 6.5.0\n",
		);
		assert.equal(decideBmadUpdate({ root, latest: "6.10.0" }).kind, "manual");
		assert.equal(decideBmadUpdate({ root, latest: null }).kind, "manual");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a failed version lookup stays unknown on a v6 install", async () => {
	const root = await v6Fixture("6.5.0");
	try {
		assert.equal(decideBmadUpdate({ root, latest: null }).kind, "unknown");
		const text = await readFile(path.join(root, ".pi", "bmad-update"), "utf8").catch(() => "");
		assert.equal(text, "");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
