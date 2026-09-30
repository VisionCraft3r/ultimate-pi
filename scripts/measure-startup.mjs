/**
 * Time what Pi pays before the prompt: importing each extension, calling its
 * factory, and awaiting session_start. Each extension runs in a fresh process
 * so one module cache cannot hide another extension's cost.
 *
 * Network and model calls are stubbed. The Cursor catalog and npm views
 * resolve immediately, and the launch-update hash matches a pre-seeded state
 * so the script does not run the test suite or install packages.
 *
 *   npm run measure:startup
 *   node scripts/measure-startup.mjs --pi     # 3 real launches to the header
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNS = 5;
const SYNC_DIRS = ["extensions", "lib", "templates", "skills", "patches"];

if (process.argv[2] === "--child") {
  await runChild(process.argv[3]);
  process.exit(0);
}

const extensions = listExtensions(ROOT);
if (process.argv.includes("--pi")) {
  await timeRealPi(3);
} else {
  const checkoutHash = hashCheckout(ROOT);
  const rows = [];
  for (const file of extensions) {
    const samples = [];
    for (let i = 0; i < RUNS; i += 1) samples.push(await timeExtension(file, checkoutHash));
    rows.push(summarize(file, samples));
  }
  printReport(rows);
  const save = process.argv.indexOf("--save");
  if (save >= 0 && process.argv[save + 1]) {
    writeFileSync(process.argv[save + 1], `${JSON.stringify({ at: new Date().toISOString(), rows }, null, 2)}\n`);
  }
}

function listExtensions(root) {
  const dir = join(root, "extensions");
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      const index = join(path, "index.ts");
      if (existsSync(index)) files.push(index);
      continue;
    }
    if (name.endsWith(".ts")) files.push(path);
  }
  return files;
}

/** Same walk as hashTree in lib/launch-update.ts. A mismatch would start the sync tests. */
function hashCheckout(root) {
  const hash = createHash("sha256");
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      if (name === "node_modules" || name === "dist") continue;
      const path = join(dir, name);
      const info = statSync(path);
      hash.update(path.slice(root.length));
      if (info.isDirectory()) walk(path);
      else hash.update(readFileSync(path));
    }
  };
  for (const dir of SYNC_DIRS) walk(join(root, dir));
  return hash.digest("hex");
}

function seedAgentDir(dir, hash) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "auth.json"), `${JSON.stringify({ cursor: { apiKey: "measure-stub" } })}\n`);
  writeFileSync(join(dir, "cursor-proxy.json"), `${JSON.stringify({ port: 9 })}\n`);
  writeFileSync(
    join(dir, "ultimate-pi-launch.json"),
    `${JSON.stringify({ hash, checkedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  writeFileSync(join(dir, "settings.json"), `${JSON.stringify({ packages: [] }, null, 2)}\n`);
}

function timeExtension(file, checkoutHash) {
  const agentDir = mkdtempSync(join(tmpdir(), "upi-startup-"));
  seedAgentDir(agentDir, checkoutHash);
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(import.meta.url), "--child", file], {
      cwd: ROOT,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: agentDir,
        ULTIMATE_PI_ROOT: ROOT,
        PI_SUBAGENT_AGENT: "",
        PI_SUBAGENT_DEPTH: "",
        PI_SUBAGENT_ID: "",
        PI_SUBAGENT_SESSION: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 60_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", () => {
      clearTimeout(timer);
      rmSync(agentDir, { recursive: true, force: true });
      const line = stdout.trim().split("\n").find((entry) => entry.startsWith("{"));
      if (!line) {
        resolvePromise({ error: stderr.trim().split("\n").slice(-4).join(" ") || "no result" });
        return;
      }
      try {
        resolvePromise(JSON.parse(line));
      } catch (err) {
        resolvePromise({ error: err instanceof Error ? err.message : String(err) });
      }
    });
  });
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function summarize(file, samples) {
  const ok = samples.filter((sample) => !sample.error);
  const label = relative(ROOT, file);
  if (ok.length === 0) return { label, error: samples[0]?.error ?? "failed" };
  const total = ok.map((sample) => sample.importMs + sample.factoryMs + sample.sessionStartMs);
  return {
    label,
    importMs: median(ok.map((sample) => sample.importMs)),
    factoryMs: median(ok.map((sample) => sample.factoryMs)),
    sessionStartMs: median(ok.map((sample) => sample.sessionStartMs)),
    totalMs: median(total),
    returnedPromise: ok.some((sample) => sample.returnedPromise),
    errors: samples.length - ok.length,
  };
}

function fmt(ms) {
  return ms.toFixed(1).padStart(8);
}

function printReport(rows) {
  console.log("extension                              import   factory  session    total  promise");
  let sum = 0;
  for (const row of rows) {
    if (row.error) {
      console.log(`${row.label.padEnd(38)} ERROR ${row.error}`);
      continue;
    }
    sum += row.totalMs;
    const flag = row.returnedPromise ? "yes" : "no";
    const warn = row.errors ? ` (${row.errors} failed runs)` : "";
    console.log(
      `${row.label.padEnd(38)}${fmt(row.importMs)}${fmt(row.factoryMs)}${fmt(row.sessionStartMs)}${fmt(row.totalMs)}  ${flag}${warn}`,
    );
  }
  console.log(`${"sum of medians".padEnd(38)}${"".padStart(24)}${fmt(sum)}`);
  console.log("Each extension is a fresh process, so shared modules are counted once per extension.");
}

async function runChild(file) {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ models: [{ id: "measure-stub" }] }),
    text: async () => "",
    headers: { get: () => null },
    arrayBuffer: async () => new ArrayBuffer(0),
  });

  const started = performance.now();
  let mod;
  try {
    mod = await import(pathToFileURL(resolve(file)).href);
  } catch (err) {
    process.stdout.write(`${JSON.stringify({ error: err instanceof Error ? err.stack ?? err.message : String(err) })}\n`);
    return;
  }
  const importMs = performance.now() - started;

  const handlers = [];
  const noop = () => {};
  const pi = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return undefined;
        if (prop === "on") {
          return (event, handler) => {
            handlers.push({ event, handler });
          };
        }
        if (prop === "getActiveTools") return () => [];
        return noop;
      },
    },
  );

  const factoryStarted = performance.now();
  try {
    if (typeof mod.default === "function") {
      const created = mod.default(pi);
      if (created && typeof created.then === "function") await created;
    }
  } catch (err) {
    process.stdout.write(
      `${JSON.stringify({ importMs, error: err instanceof Error ? err.stack ?? err.message : String(err) })}\n`,
    );
    return;
  }
  const factoryMs = performance.now() - factoryStarted;

  const theme = new Proxy({}, { get: () => () => "" });
  const ctx = {
    hasUI: false,
    mode: "tui",
    sessionManager: { getEntries: () => [] },
    ui: {
      notify: noop,
      setStatus: noop,
      setHeader: noop,
      setWidget: noop,
      theme,
    },
  };
  const event = { reason: "startup" };
  let returnedPromise = false;
  const sessionStarted = performance.now();
  try {
    for (const entry of handlers) {
      if (entry.event !== "session_start") continue;
      const result = entry.handler(event, ctx);
      if (result && typeof result.then === "function") {
        returnedPromise = true;
        await result;
      }
    }
  } catch (err) {
    process.stdout.write(
      `${JSON.stringify({
        importMs,
        factoryMs,
        error: err instanceof Error ? err.stack ?? err.message : String(err),
      })}\n`,
    );
    return;
  }
  const sessionStartMs = performance.now() - sessionStarted;
  process.stdout.write(`${JSON.stringify({ importMs, factoryMs, sessionStartMs, returnedPromise })}\n`);
}

function timeRealPi(runs) {
  const piBin = process.env.PI_BIN || "pi";
  const python = `
import os, pty, select, time, signal, shutil
marker = b"Multi-agent routing"
pi = os.environ.get("PI_BIN") or shutil.which("pi") or "pi"
start = time.perf_counter()
pid, fd = pty.fork()
if pid == 0:
    os.environ.pop("PI_SUBAGENT_AGENT", None)
    os.execvp(pi, [pi])
buf = b""
deadline = start + 45
elapsed = None
while time.perf_counter() < deadline:
    ready, _, _ = select.select([fd], [], [], 0.2)
    if not ready:
        continue
    try:
        chunk = os.read(fd, 8192)
    except OSError:
        break
    if not chunk:
        break
    buf += chunk
    if marker in buf:
        elapsed = time.perf_counter() - start
        break
try:
    os.kill(pid, signal.SIGKILL)
except OSError:
    pass
for _ in range(25):
    wpid, _ = os.waitpid(pid, os.WNOHANG)
    if wpid == pid:
        break
    time.sleep(0.05)
if elapsed is None:
    tail = buf[-400:].decode("utf-8", "replace").replace("\\n", " | ")
    print(f"FAIL {tail}", flush=True)
else:
    print(f"{elapsed:.3f}", flush=True)
`;
  const samples = [];
  return new Promise((resolvePromise) => {
    const next = (index) => {
      if (index >= runs) {
        const ok = samples.filter((sample) => sample.seconds != null).map((sample) => sample.seconds);
        console.log("pi launch to header (seconds):");
        for (const sample of samples) {
          console.log(sample.seconds == null ? `  FAIL ${sample.detail}` : `  ${sample.seconds.toFixed(3)}`);
        }
        if (ok.length > 0) console.log(`  median ${median(ok).toFixed(3)}`);
        resolvePromise();
        return;
      }
      const child = spawn("python3", ["-c", python], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PI_BIN: piBin },
      });
      let out = "";
      let err = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        out += chunk;
      });
      child.stderr.on("data", (chunk) => {
        err += chunk;
      });
      child.on("close", () => {
        const line = out.trim().split("\n").pop() ?? "";
        if (line.startsWith("FAIL")) samples.push({ seconds: null, detail: line.slice(5) || err.trim() });
        else {
          const seconds = Number(line);
          samples.push(Number.isFinite(seconds) ? { seconds } : { seconds: null, detail: line || err.trim() || "no output" });
        }
        next(index + 1);
      });
    };
    next(0);
  });
}
