#!/usr/bin/env node
/**
 * Verifies that every relative import in the files `npm pack` would ship is
 * itself shipped. Prevents a published tarball that ships code with broken
 * relative imports because a dependency file was left out of `files` in
 * package.json.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, posix } from "node:path";
import { readFileSync } from "node:fs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// Matches:
//   import ... from "x"
//   export ... from "x"
//   import "x"
//   import("x")
const IMPORT_RE =
  /(?:import|export)(?:[^'";]*?from\s*)?\s*\(?\s*["']([^"']+)["']\s*\)?/g;

// Backtick template literals, e.g. `import { x } from "./y.ts";` written as
// *data* (codegen/patch strings), not as real source code. Stripped before
// matching so they are not mistaken for actual imports.
const TEMPLATE_LITERAL_RE = /`(?:\\.|[^`\\])*`/g;

function extractSpecifiers(text) {
  const withoutTemplates = text.replace(TEMPLATE_LITERAL_RE, "");
  const specs = [];
  let match;
  IMPORT_RE.lastIndex = 0;
  while ((match = IMPORT_RE.exec(withoutTemplates)) !== null) {
    specs.push(match[1]);
  }
  return specs.filter((spec) => spec.startsWith("./") || spec.startsWith("../"));
}

function resolveSpecifier(fromPath, spec) {
  const fromDir = posix.dirname(fromPath);
  return posix.normalize(posix.join(fromDir, spec));
}

/**
 * @param {string[]} packed - packed relative paths (posix-style, as reported by `npm pack`)
 * @param {(path: string) => string} read - reads the content of a packed file by its path
 * @returns {{from: string; spec: string}[]}
 */
export function missingImports(packed, read) {
  const packedSet = new Set(packed);
  const problems = [];
  for (const file of packed) {
    if (!/\.(mjs|js|ts)$/.test(file)) continue;
    let text;
    try {
      text = read(file);
    } catch {
      continue;
    }
    const specs = extractSpecifiers(text);
    for (const spec of specs) {
      const resolved = resolveSpecifier(file, spec);
      // A specifier without an extension may resolve to several candidate
      // files (e.g. `./foo` -> `./foo.ts`, `./foo.js`, `./foo/index.ts`).
      const candidates = new Set([resolved]);
      if (!/\.(mjs|js|ts|json|cjs)$/.test(resolved)) {
        candidates.add(`${resolved}.mjs`);
        candidates.add(`${resolved}.js`);
        candidates.add(`${resolved}.ts`);
        candidates.add(`${resolved}.cjs`);
        candidates.add(posix.join(resolved, "index.mjs"));
        candidates.add(posix.join(resolved, "index.js"));
        candidates.add(posix.join(resolved, "index.ts"));
      }
      const found = [...candidates].some((candidate) => packedSet.has(candidate));
      if (!found) {
        problems.push({ from: file, spec });
      }
    }
  }
  return problems;
}

async function runMain() {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw new Error(`could not parse npm pack output: ${error.message}`);
  }
  const packed = parsed[0].files.map((entry) => entry.path);

  const problems = missingImports(packed, (path) =>
    readFileSync(join(REPO_ROOT, path), "utf8"),
  );

  if (problems.length > 0) {
    console.error(`✖ check-pack: ${problems.length} unpacked import(s) found`);
    for (const problem of problems) {
      console.error(`  ${problem.from} imports unpacked "${problem.spec}"`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`✔ check-pack: ${packed.length} files, all relative imports packed`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  runMain().catch((error) => {
    console.error(`✖ check-pack: could not complete: ${error.message}`);
    process.exitCode = 1;
  });
}
