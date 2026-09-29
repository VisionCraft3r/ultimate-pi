/**
 * Offer BMAD's own quick update for an older v6 install.
 * `_bmad/custom/` is hashed before and after. This module never edits those files.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

export const UPDATE_NOTICE = [
	"Quick update refreshes BMAD and does not modify _bmad/custom/ (team .toml and personal .user.toml).",
	"Installed skill files and each skill's customize.toml are replaced. Edits inside .agents/skills/ do not survive.",
	"_bmad/config.toml is rewritten from the saved install answers. Durable settings belong in _bmad/custom/config.toml.",
	"Files copied into the module tree, such as an extra workflow under _bmad/bmm/, are not in the protected set.",
].join(" ");

export function quickUpdateArgv(projectRoot: string): string[] {
	return [
		"npx",
		"--yes",
		"bmad-method@latest",
		"install",
		"--yes",
		"--action",
		"quick-update",
		"--directory",
		projectRoot,
	];
}

export function quickUpdateArgvIfBmad(choice: string | null, projectRoot: string): string[] | null {
	if (choice !== "bmad") return null;
	return quickUpdateArgv(projectRoot);
}

export function parseSemver(version: string): [number, number, number] | null {
	const match = version.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
	if (!match) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Negative when left is older. Null when either side is not semver. */
export function compareSemver(left: string, right: string): number | null {
	const a = parseSemver(left);
	const b = parseSemver(right);
	if (!a || !b) return null;
	for (let i = 0; i < 3; i++) {
		if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
	}
	return 0;
}

export function readInstalledVersion(root: string): string | null {
	const path = join(root, "_bmad", "_config", "manifest.yaml");
	if (!existsSync(path)) return null;
	const text = readFileSync(path, "utf8");
	const block = text.match(/^installation:\n([\s\S]*?)(?=\n\S|$)/m);
	if (!block) return null;
	const version = block[1].match(/^\s+version:\s*["']?([^\s"']+)/m);
	return version?.[1] ?? null;
}

export function isV6SkillLayout(root: string): boolean {
	const skills = join(root, ".agents", "skills");
	if (!existsSync(skills)) return false;
	for (const entry of readdirSync(skills, { withFileTypes: true })) {
		if (!entry.isDirectory() || !entry.name.startsWith("bmad-agent-")) continue;
		if (existsSync(join(skills, entry.name, "customize.toml"))) return true;
	}
	return false;
}

export function isV6Install(root: string): boolean {
	const version = readInstalledVersion(root);
	const parsed = version ? parseSemver(version) : null;
	if (!parsed || parsed[0] !== 6) return false;
	return isV6SkillLayout(root);
}

export function bmadUpdatePath(root: string): string {
	return join(root, ".pi", "bmad-update");
}

export function readDeclinedUpdate(root: string): string | null {
	const path = bmadUpdatePath(root);
	if (!existsSync(path)) return null;
	const match = readFileSync(path, "utf8").trim().match(/^declined\s+(\S+)$/);
	return match?.[1] ?? null;
}

export function writeDeclinedUpdate(root: string, latest: string): void {
	const path = bmadUpdatePath(root);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `declined ${latest}\n`);
}

export type UpdateDecision =
	| { kind: "manual" }
	| { kind: "unknown" }
	| { kind: "current" }
	| { kind: "declined" }
	| { kind: "offer"; installed: string; latest: string };

export function decideBmadUpdate(input: {
	root: string;
	latest: string | null;
	force?: boolean;
}): UpdateDecision {
	if (!isV6Install(input.root)) return { kind: "manual" };
	const installed = readInstalledVersion(input.root);
	if (!installed || !input.latest || compareSemver(installed, input.latest) === null) return { kind: "unknown" };
	if (compareSemver(installed, input.latest)! >= 0) return { kind: "current" };
	if (!input.force && readDeclinedUpdate(input.root) === input.latest) return { kind: "declined" };
	return { kind: "offer", installed, latest: input.latest };
}

export function isExplicitBmadUpdateRequest(prompt: string): boolean {
	return /\bupdate\s+bmad\b/i.test(prompt);
}

export type CustomHashes = Map<string, string>;

function walkFiles(dir: string, out: string[]): void {
	if (!existsSync(dir)) return;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) walkFiles(path, out);
		else if (entry.isFile()) out.push(path);
	}
}

export function hashCustomTree(root: string): CustomHashes {
	const dir = join(root, "_bmad", "custom");
	const hashes: CustomHashes = new Map();
	const files: string[] = [];
	walkFiles(dir, files);
	for (const file of files.sort()) {
		const body = readFileSync(file);
		const digest = createHash("sha256").update(body).digest("hex");
		hashes.set(relative(dir, file), digest);
	}
	return hashes;
}

export function diffCustomHashes(before: CustomHashes, after: CustomHashes): string[] {
	const paths = new Set([...before.keys(), ...after.keys()]);
	return [...paths].filter((path) => before.get(path) !== after.get(path)).sort();
}

export function lookupLatestBmad(exec: () => Promise<string> = npmViewBmadVersion): Promise<string | null> {
	return exec()
		.then((output) => {
			const version = output.trim().split(/\s+/).pop() ?? "";
			const parsed = parseSemver(version);
			return parsed ? version.replace(/^v/, "") : null;
		})
		.catch(() => null);
}

function npmViewBmadVersion(): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn("npm", ["view", "bmad-method", "version"], { env: process.env });
		let output = "";
		child.stdout.on("data", (chunk) => {
			output += String(chunk);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolve(output);
			else reject(new Error(`npm view exited ${code}`));
		});
	});
}

export function runQuickUpdate(projectRoot: string): Promise<{ code: number; output: string }> {
	const argv = quickUpdateArgv(projectRoot);
	return new Promise((resolve) => {
		const child = spawn(argv[0], argv.slice(1), { cwd: projectRoot, env: process.env });
		let output = "";
		child.stdout?.on("data", (chunk) => {
			output += String(chunk);
		});
		child.stderr?.on("data", (chunk) => {
			output += String(chunk);
		});
		child.on("error", (error) => resolve({ code: 1, output: error.message }));
		child.on("close", (code) => resolve({ code: code ?? 1, output }));
	});
}
