/**
 * Node 22's test runner has no --test-isolation=none. On that version, run
 * one file at a time. Node 24+ isolates each file in a process, and the
 * installer doctor lines then corrupt the runner IPC, so those versions stay
 * in-process.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const files = readdirSync("test")
  .filter((name) => name.endsWith(".test.ts"))
  .sort()
  .map((name) => join("test", name));

const major = Number(process.versions.node.split(".")[0]);
const args = ["--experimental-strip-types", "--test"];
if (major >= 24) args.push("--test-isolation=none");
else args.push("--test-concurrency=1");
args.push(...files, ...process.argv.slice(2));

const result = spawnSync(process.execPath, args, { stdio: "inherit" });
process.exit(result.status ?? 1);
