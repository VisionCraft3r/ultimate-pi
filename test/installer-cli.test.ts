import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const BIN = resolve(fileURLToPath(new URL("../bin/ultimate-pi.mjs", import.meta.url)));

test("npm-style symlink invokes the CLI rather than silently exiting", () => {
  const dir = mkdtempSync(join(tmpdir(), "ultimate-pi-cli-"));
  try {
    const link = join(dir, "ultimate-pi");
    symlinkSync(BIN, link);
    const result = spawnSync(process.execPath, [link, "--help"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:\s+ultimate-pi/);
    assert.match(result.stdout, /--agent-dir/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
