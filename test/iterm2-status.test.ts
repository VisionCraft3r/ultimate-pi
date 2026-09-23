import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveStatusBin } from "../extras/macos/iterm2-status.ts";

test("iterm2 status bin is a no-op when ULTIMATE_PI_ITERM_STATUS_BIN is missing", () => {
	const prev = process.env.ULTIMATE_PI_ITERM_STATUS_BIN;
	process.env.ULTIMATE_PI_ITERM_STATUS_BIN = join(
		tmpdir(),
		"upi-iterm-status-does-not-exist",
	);
	try {
		assert.equal(resolveStatusBin(), undefined);
	} finally {
		if (prev === undefined) delete process.env.ULTIMATE_PI_ITERM_STATUS_BIN;
		else process.env.ULTIMATE_PI_ITERM_STATUS_BIN = prev;
	}
});

test("iterm2 status bin uses ULTIMATE_PI_ITERM_STATUS_BIN when the file exists", () => {
	const dir = mkdtempSync(join(tmpdir(), "upi-iterm-status-"));
	const bin = join(dir, "status-bin");
	const prev = process.env.ULTIMATE_PI_ITERM_STATUS_BIN;
	try {
		writeFileSync(bin, "#!/bin/sh\nexit 0\n");
		chmodSync(bin, 0o755);
		process.env.ULTIMATE_PI_ITERM_STATUS_BIN = bin;
		assert.equal(resolveStatusBin(), bin);
	} finally {
		if (prev === undefined) delete process.env.ULTIMATE_PI_ITERM_STATUS_BIN;
		else process.env.ULTIMATE_PI_ITERM_STATUS_BIN = prev;
		rmSync(dir, { recursive: true, force: true });
	}
});
