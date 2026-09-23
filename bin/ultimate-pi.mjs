#!/usr/bin/env node
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";

const SETUP_TOPICS = ["providers", "agents", "fallbacks", "jev", "memory", "extras"];
const COMMANDS = ["install", "setup", "doctor", "uninstall"];

function usage(code = 0) {
  console.log(`Usage:
  ultimate-pi [install] [flags]
  ultimate-pi setup <${SETUP_TOPICS.join("|")}> [flags]
  ultimate-pi doctor [flags]
  ultimate-pi uninstall [flags]

Flags:
  --agent-dir <path>   Agent directory (else PI_CODING_AGENT_DIR, else ~/.pi/agent)
  --answers <file>     Pre-filled answers JSON (non-interactive)
  --yes                Accept all defaults
  --dry-run            Print actions without writing
  --offline            Skip network checks and live probes
  --local              Pi settings scope (local project), not package source
  --full, --purge      Uninstall only: also remove model-agents.json and third-party
                       packages Ultimate Pi installed. Never deletes auth.json.
                       Default uninstall without this flag stays conservative.
  --no-color           Disable ANSI color
  -h, --help           Show this help`);
  process.exit(code);
}

function needValue(argv, i, flag) {
  if (i >= argv.length || argv[i].startsWith("-")) {
    console.error(`${flag} requires a value`);
    process.exit(1);
  }
  return argv[i];
}

export function parseArgs(argv) {
  const options = {
    agentDir: process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent"),
    answersPath: null,
    yes: false,
    dryRun: false,
    offline: false,
    local: false,
    full: false,
    purge: false,
    noColor: Boolean(process.env.NO_COLOR),
    command: "install",
    setupTopic: null,
  };
  const positionals = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") usage(0);
    else if (arg === "--yes") options.yes = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--offline") options.offline = true;
    else if (arg === "--local") options.local = true;
    else if (arg === "--full" || arg === "--purge") {
      options.full = true;
      options.purge = true;
    }
    else if (arg === "--no-color") options.noColor = true;
    else if (arg === "--agent-dir") options.agentDir = resolve(needValue(argv, ++i, arg));
    else if (arg.startsWith("--agent-dir=")) options.agentDir = resolve(arg.slice(12));
    else if (arg === "--answers") options.answersPath = resolve(needValue(argv, ++i, arg));
    else if (arg.startsWith("--answers=")) options.answersPath = resolve(arg.slice(10));
    else if (arg.startsWith("-")) {
      console.error(`Unknown flag: ${arg}`);
      usage(1);
    } else {
      positionals.push(arg);
    }
  }

  const [command, topic, extra] = positionals;
  if (command) {
    if (!COMMANDS.includes(command)) {
      console.error(`Unknown command: ${command}`);
      usage(1);
    }
    options.command = command;
  }
  if (options.command === "setup") {
    if (!SETUP_TOPICS.includes(topic)) {
      console.error(`setup requires one of: ${SETUP_TOPICS.join(", ")}`);
      usage(1);
    }
    options.setupTopic = topic;
  } else if (topic) {
    console.error(`Unexpected argument: ${topic}`);
    usage(1);
  }
  if (extra) {
    console.error(`Unexpected argument: ${extra}`);
    usage(1);
  }
  return options;
}

function mainModuleHref(entry) {
  const resolved = resolve(entry);
  try {
    return pathToFileURL(realpathSync(resolved)).href;
  } catch {
    return pathToFileURL(resolved).href;
  }
}

const isMain =
  Boolean(process.argv[1]) && mainModuleHref(process.argv[1]) === import.meta.url;

if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  if (options.noColor) process.env.NO_COLOR = "1";
  const { dispatch } = await import(new URL("../installer/index.mjs", import.meta.url));
  process.exit((await dispatch(options)) ?? 0);
}
