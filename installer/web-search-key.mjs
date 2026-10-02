import * as p from "@clack/prompts";
import { readFile, mkdir, writeFile, chmod } from "node:fs/promises";
import { dirname, join } from "node:path";

export const WEB_SEARCH_AUTH_RELPATH = "extensions/web-search/auth.json";
const PLACEHOLDER = "your-tavily-api-key-here";
const nonempty = (value) => typeof value === "string" && value.trim() !== PLACEHOLDER ? value.trim() : "";

export function webSearchAuthPath(agentDir) {
  return join(agentDir, WEB_SEARCH_AUTH_RELPATH);
}

async function readAuthObject(agentDir) {
  let raw;
  try {
    raw = await readFile(webSearchAuthPath(agentDir), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function readWebSearchKey(agentDir) {
  return nonempty((await readAuthObject(agentDir)).tavily_api_key);
}

export async function writeWebSearchKey(agentDir, key, backupSession) {
  const file = webSearchAuthPath(agentDir);
  const existing = await readAuthObject(agentDir);
  await mkdir(dirname(file), { recursive: true });
  await backupSession?.backupIfExists(WEB_SEARCH_AUTH_RELPATH);
  await writeFile(file, `${JSON.stringify({ ...existing, tavily_api_key: key }, null, 2)}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
  return file;
}

export async function configureWebSearchKey(options = {}, { force = false } = {}) {
  p.note("web_search uses the Tavily Search API. It needs a Tavily key (tvly-…). TAVILY_API_KEY in the environment also works. Skip to leave web_search without credentials. Configure later with: ultimate-pi setup web-search", "Web search / Tavily");
  let key = nonempty(options.answers?.tavilyKey);
  let source = key ? "answers" : "none";
  if (!key) {
    const existing = await readWebSearchKey(options.agentDir);
    if (existing && !force) return { tavilyKey: existing, configured: true, source: "existing" };
    if (!options.yes && !options.dryRun) {
      const input = await p.password({
        message: force && existing ? "Tavily API key (Enter to keep current)" : "Tavily API key for web_search (Enter to skip)",
        mask: "•",
      });
      if (p.isCancel(input)) {
        p.cancel("Web search setup cancelled.");
        process.exit(0);
      }
      key = nonempty(input);
      if (key) source = "prompt";
    }
    if (!key && existing) {
      key = existing;
      source = "existing";
    }
  }
  if (source === "answers" || source === "prompt") {
    if (options.dryRun) p.log.info(`[dry-run] would write ${webSearchAuthPath(options.agentDir)}`);
    else await writeWebSearchKey(options.agentDir, key, options.backupSession);
  }
  if (source === "none") {
    p.log.info("Skipping Tavily key — web_search will report missing credentials.");
    p.log.info("Configure later with: ultimate-pi setup web-search");
  }
  return { tavilyKey: key, configured: Boolean(key), source };
}
