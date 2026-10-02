import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { configureWebSearchKey, readWebSearchKey, writeWebSearchKey, webSearchAuthPath, WEB_SEARCH_AUTH_RELPATH } from "../installer/web-search-key.mjs";
import { loadAnswers } from "../installer/answers.mjs";
import { lintAgentProfile } from "../lib/agent-profile.ts";

const KEY = "test-key-not-real";
async function withDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "installer-web-search-"));
  try {
    await run(dir);
    await assert.rejects(stat(join(dir, "auth.json")), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function enterPrompt(dir: string, force = false) {
  const moduleUrl = new URL("../installer/web-search-key.mjs", import.meta.url).href;
  const code = `import { configureWebSearchKey } from ${JSON.stringify(moduleUrl)}; console.log('RESULT:' + JSON.stringify(await configureWebSearchKey({ agentDir: ${JSON.stringify(dir)} }, { force: ${force} }))); process.exit(0);`;
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["pipe", "pipe", "pipe"], timeout: 5000 });
    let output = "";
    let sent = false;
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (!sent && /Enter to (skip|keep current)/.test(output)) {
        sent = true;
        child.stdin.write("\r");
      }
      if (output.includes("RESULT:")) child.stdin.end();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", reject);
    child.on("close", (status) => status === 0 ? resolve(output) : reject(new Error(output)));
  });
}

test("writes extension credentials only with mode 0600", () => withDir(async (dir) => {
  assert.equal(await writeWebSearchKey(dir, KEY), webSearchAuthPath(dir));
  assert.deepEqual(JSON.parse(await readFile(webSearchAuthPath(dir), "utf8")), { tavily_api_key: KEY });
  assert.equal((await stat(webSearchAuthPath(dir))).mode & 0o777, 0o600);
}));

test("merges existing object and backs up the extension-relative path", () => withDir(async (dir) => {
  await mkdir(join(dir, "extensions/web-search"), { recursive: true });
  await writeFile(webSearchAuthPath(dir), '{"other":1}', { mode: 0o644 });
  const backups: string[] = [];
  await writeWebSearchKey(dir, KEY, { backupIfExists: async (path: string) => { backups.push(path); } });
  assert.deepEqual(backups, [WEB_SEARCH_AUTH_RELPATH]);
  assert.deepEqual(JSON.parse(await readFile(webSearchAuthPath(dir), "utf8")), { other: 1, tavily_api_key: KEY });
  assert.equal((await stat(webSearchAuthPath(dir))).mode & 0o777, 0o600);
}));

test("reads missing, placeholder, malformed and valid credentials", () => withDir(async (dir) => {
  assert.equal(await readWebSearchKey(dir), "");
  await mkdir(join(dir, "extensions/web-search"), { recursive: true });
  for (const raw of ['{"tavily_api_key":"your-tavily-api-key-here"}', 'invalid', 'null', '[]']) {
    await writeFile(webSearchAuthPath(dir), raw);
    assert.equal(await readWebSearchKey(dir), "");
  }
  await writeWebSearchKey(dir, KEY);
  assert.equal(await readWebSearchKey(dir), KEY);
}));

test("answers key configures web search", () => withDir(async (dir) => {
  assert.deepEqual(await configureWebSearchKey({ agentDir: dir, yes: true, answers: { tavilyKey: KEY } }), {
    tavilyKey: KEY, configured: true, source: "answers",
  });
  assert.equal(await readWebSearchKey(dir), KEY);
}));

test("yes skips absent credentials without creating files", () => withDir(async (dir) => {
  assert.deepEqual(await configureWebSearchKey({ agentDir: dir, yes: true }), { tavilyKey: "", configured: false, source: "none" });
  await assert.rejects(stat(webSearchAuthPath(dir)), { code: "ENOENT" });
}));

test("existing key is reused without rewriting", () => withDir(async (dir) => {
  await writeWebSearchKey(dir, KEY);
  const before = await stat(webSearchAuthPath(dir));
  assert.equal((await configureWebSearchKey({ agentDir: dir, yes: true })).source, "existing");
  assert.equal((await stat(webSearchAuthPath(dir))).mtimeMs, before.mtimeMs);
}));

test("dry run with answers writes nothing", () => withDir(async (dir) => {
  assert.equal((await configureWebSearchKey({ agentDir: dir, dryRun: true, answers: { tavilyKey: KEY } })).source, "answers");
  await assert.rejects(stat(webSearchAuthPath(dir)), { code: "ENOENT" });
}));

test("Enter skips the masked prompt without writing", { timeout: 10000 }, () => withDir(async (dir) => {
  assert.match(await enterPrompt(dir), /RESULT:.*"configured":false,"source":"none"/);
  await assert.rejects(stat(webSearchAuthPath(dir)), { code: "ENOENT" });
}));

test("forced prompt Enter keeps the existing key", { timeout: 10000 }, () => withDir(async (dir) => {
  await writeWebSearchKey(dir, KEY);
  const before = await readFile(webSearchAuthPath(dir), "utf8");
  assert.match(await enterPrompt(dir, true), /RESULT:.*"source":"existing"/);
  assert.equal(await readFile(webSearchAuthPath(dir), "utf8"), before);
}));

test("main provider auth.json remains untouched", async () => {
  const dir = await mkdtemp(join(tmpdir(), "installer-web-search-main-"));
  try {
    const mainAuth = '{"provider":{"type":"api_key","key":"fake-provider-key"}}\n';
    await writeFile(join(dir, "auth.json"), mainAuth);
    await configureWebSearchKey({ agentDir: dir, yes: true, answers: { tavilyKey: KEY } });
    assert.equal(await readFile(join(dir, "auth.json"), "utf8"), mainAuth);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("managed template hardening is before cache discipline and setup topic is present", async () => {
  const text = await readFile(new URL("../templates/AGENTS.md.tmpl", import.meta.url), "utf8");
  const heading = text.indexOf("## SESSION-AUDIT HARDENING RULES");
  assert.ok(heading > text.indexOf("<!-- ultimate-pi:begin -->"));
  assert.ok(heading < text.indexOf("## Cache discipline"));
  assert.ok(heading < text.indexOf("<!-- ultimate-pi:end -->"));
  assert.ok(text.includes("jev|memory|web-search|extras"));
});

test("worker profile grants every browser tool and passes lint", async () => {
  const text = await readFile(new URL("../templates/agents/worker.md", import.meta.url), "utf8");
  assert.deepEqual(lintAgentProfile(text, "worker.md"), []);
  const tools = text.split("\n").find((line) => line.startsWith("tools:"))!;
  for (const tool of ["browser_goto", "browser_click", "browser_eval", "browser_fill", "browser_screenshot", "browser_console", "browser_network"]) assert.ok(tools.includes(tool));
});

test("answers loading and schema accept tavilyKey", () => withDir(async (dir) => {
  const file = join(dir, "answers.json");
  await writeFile(file, JSON.stringify({ providers: [], agentAssignments: {}, tavilyKey: KEY }));
  assert.equal((await loadAnswers(file)).tavilyKey, KEY);
  const schema = JSON.parse(await readFile(new URL("../schemas/answers.schema.json", import.meta.url), "utf8"));
  assert.deepEqual(schema.properties.tavilyKey, { type: "string" });
}));
