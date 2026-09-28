/**
 * Pi loads every top-level extensions/*.ts and *.js in the agent dir as an
 * extension factory, and index.ts inside each subdirectory. Helpers belong in
 * lib/. Copying one into extensions/ makes `pi` exit before tmux can work.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const FACTORY = /export\s+default\s+(?:async\s+)?(?:function\b|\()/;

export function isExtensionSourceName(name: string): boolean {
  return name.endsWith(".ts") || name.endsWith(".js");
}

export function isExtensionFactorySource(source: string): boolean {
  return FACTORY.test(source);
}

export function unsafeExtensionEntries(extensionsDir: string): string[] {
  if (!existsSync(extensionsDir)) return [];
  const unsafe: string[] = [];
  for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(extensionsDir, entry.name);
    if (entry.isFile() && isExtensionSourceName(entry.name)) {
      if (!isExtensionFactorySource(readFileSync(path, "utf8"))) unsafe.push(entry.name);
      continue;
    }
    if (!entry.isDirectory()) continue;
    for (const indexName of ["index.ts", "index.js"]) {
      const indexPath = join(path, indexName);
      if (!existsSync(indexPath)) continue;
      if (!isExtensionFactorySource(readFileSync(indexPath, "utf8"))) unsafe.push(join(entry.name, indexName));
    }
  }
  return unsafe;
}

/** Copy an extensions tree without placing non-factory files where Pi will load them. */
export function copyExtensionTree(from: string, to: string): string[] {
  mkdirSync(to, { recursive: true });
  const skipped: string[] = [];
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const src = join(from, entry.name);
    const dest = join(to, entry.name);
    if (entry.isDirectory()) {
      cpSync(src, dest, { recursive: true });
      continue;
    }
    if (entry.isFile() && isExtensionSourceName(entry.name) && !isExtensionFactorySource(readFileSync(src, "utf8"))) {
      skipped.push(entry.name);
      continue;
    }
    if (entry.isFile()) cpSync(src, dest);
  }
  return skipped;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isDirectRun() && process.argv.includes("--check")) {
  const agentDir = process.argv[process.argv.indexOf("--check") + 1];
  if (!agentDir) {
    process.stderr.write("usage: extension-layout.ts --check <agent-dir>\n");
    process.exit(2);
  }
  const unsafe = unsafeExtensionEntries(join(agentDir, "extensions"));
  if (unsafe.length > 0) {
    process.stdout.write(
      `Pi would refuse to start. These files are in extensions/ but are not extension factories: ${unsafe.join(", ")}. Move helpers to lib/.\n`,
    );
    process.exit(1);
  }
}
