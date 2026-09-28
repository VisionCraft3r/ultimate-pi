import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import type { spawn } from "node:child_process";
import { reviewPlanInBrowser } from "../lib/plan-review.ts";
import "../lib/strip-node-modules-types.mjs";

test("node_modules TypeScript loads through the strip hook", async () => {
  const root = mkdtempSync(join(tmpdir(), "upi-strip-"));
  const file = join(root, "node_modules", "pkg", "mod.ts");
  mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
  writeFileSync(file, "export const value: number = 7;\nexport function greet(name: string): string { return name; }\n");
  try {
    const mod = await import(pathToFileURL(file).href) as { value: number; greet: (name: string) => string };
    assert.equal(mod.value, 7);
    assert.equal(mod.greet("plan"), "plan");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("review spawns the host with the node_modules type strip loader", async () => {
  const root = mkdtempSync(join(tmpdir(), "upi-review-"));
  const plan = join(root, "plan.md");
  writeFileSync(plan, "# plan\n");
  const pkg = join(root, "npm", "node_modules", "@plannotator", "pi-extension");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "package.json"), "{}\n");
  let args: string[] = [];
  const launch = ((_command: string, argv: readonly string[]) => {
    args = [...argv];
    const stdout = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
    const stderr = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
    stdout.setEncoding = () => {};
    stderr.setEncoding = () => {};
    const child = new EventEmitter() as EventEmitter & { stdout: typeof stdout; stderr: typeof stderr };
    child.stdout = stdout;
    child.stderr = stderr;
    queueMicrotask(() => {
      stdout.emit("data", `${JSON.stringify({ url: "http://127.0.0.1:9", decision: { approved: true } })}\n`);
      child.emit("close", 0);
    });
    return child;
  }) as unknown as typeof spawn;
  try {
    const decision = await reviewPlanInBrowser(plan, root, launch);
    assert.equal(decision.approved, true);
    assert.equal(decision.url, "http://127.0.0.1:9");
    assert.deepEqual(args.slice(0, 2), ["--experimental-strip-types", "--import"]);
    assert.match(args[2] ?? "", /strip-node-modules-types\.mjs$/);
    assert.match(args[3] ?? "", /plan-review-host\.ts$/);
    assert.equal(args[4], plan);
    assert.equal(args[5], root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
