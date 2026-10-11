import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic, writeFileAtomicSync } from "../lib/atomic-write.ts";

test("writeFileAtomicSync writes correct content, leaves no tmp files, and honors mode", () => {
	const dir = mkdtempSync(join(tmpdir(), "atomic-write-"));
	try {
		const file = join(dir, "state.json");
		writeFileAtomicSync(file, '{"a":1}\n', 0o600);
		assert.equal(readFileSync(file, "utf8"), '{"a":1}\n');
		const entries = readdirSync(dir);
		assert.deepEqual(entries, ["state.json"]);
		assert.ok(entries.every((name) => !name.includes(".tmp-")));
		if (process.platform !== "win32") {
			assert.equal(statSync(file).mode & 0o777, 0o600);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("writeFileAtomic writes correct content, leaves no tmp files, and honors mode", async () => {
	const dir = mkdtempSync(join(tmpdir(), "atomic-write-"));
	try {
		const file = join(dir, "state.json");
		await writeFileAtomic(file, '{"b":2}\n', 0o640);
		assert.equal(readFileSync(file, "utf8"), '{"b":2}\n');
		const entries = readdirSync(dir);
		assert.deepEqual(entries, ["state.json"]);
		assert.ok(entries.every((name) => !name.includes(".tmp-")));
		if (process.platform !== "win32") {
			assert.equal(statSync(file).mode & 0o777, 0o640);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("writeFileAtomic overwrites existing content and still leaves no tmp files on second write", async () => {
	const dir = mkdtempSync(join(tmpdir(), "atomic-write-"));
	try {
		const file = join(dir, "state.json");
		await writeFileAtomic(file, '{"v":1}\n');
		await writeFileAtomic(file, '{"v":2}\n');
		assert.equal(readFileSync(file, "utf8"), '{"v":2}\n');
		const entries = readdirSync(dir);
		assert.deepEqual(entries, ["state.json"]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
