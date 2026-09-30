import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function run(code: string, env: NodeJS.ProcessEnv = {}): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

test("web-fetch import does not load unpdf until a PDF conversion", () => {
  const result = run(`
    import { registerHooks } from "node:module";
    const loaded = [];
    registerHooks({
      load(url, context, nextLoad) {
        loaded.push(String(url));
        return nextLoad(url, context);
      },
    });
    await import("./extensions/web-fetch/index.ts");
    const before = loaded.some((url) => url.includes("/unpdf/"));
    const { pdfToMarkdown } = await import("./extensions/web-fetch/convert.ts");
    await pdfToMarkdown(new Uint8Array([0x25, 0x50, 0x44, 0x46])).catch(() => {});
    const after = loaded.some((url) => url.includes("/unpdf/"));
    console.log(JSON.stringify({ before, after }));
  `);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout.trim().split("\n").pop() ?? "");
  assert.equal(report.before, false);
  assert.equal(report.after, true);
});

test("browser extension import does not load Playwright", () => {
  const result = run(`
    import { registerHooks } from "node:module";
    const loaded = [];
    registerHooks({
      load(url, context, nextLoad) {
        loaded.push(String(url));
        return nextLoad(url, context);
      },
    });
    await import("./extensions/browser/index.ts");
    console.log(JSON.stringify({ playwright: loaded.some((url) => url.includes("playwright-core")) }));
  `);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout.trim().split("\n").pop() ?? "");
  assert.equal(report.playwright, false);
});

test("model-agents session_start does not return a promise", () => {
  const dir = mkdtempSync(join(tmpdir(), "upi-scan-"));
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "auth.json"), `${JSON.stringify({ cursor: { apiKey: "measure-stub" } })}\n`);
    writeFileSync(join(dir, "cursor-proxy.json"), `${JSON.stringify({ port: 9 })}\n`);
    const result = run(
      `
        globalThis.fetch = async () => ({
          ok: true,
          json: async () => ({ models: [{ id: "measure-stub" }] }),
        });
        const mod = await import("./extensions/model-agents.ts");
        let handler;
        mod.default({
          on(event, fn) { if (event === "session_start") handler = fn; },
          registerCommand() {},
        });
        const returned = handler({}, { ui: { notify() {} } });
        const isPromise = returned != null && typeof returned.then === "function";
        console.log(JSON.stringify({ isPromise, kind: returned === undefined ? "undefined" : typeof returned }));
      `,
      { PI_CODING_AGENT_DIR: dir },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout.trim().split("\n").pop() ?? "");
    assert.equal(report.isPromise, false);
    assert.equal(report.kind, "undefined");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
