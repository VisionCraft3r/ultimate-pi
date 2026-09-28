/**
 * Node 24 refuses to type-strip .ts files under node_modules
 * (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). Plannotator's package is
 * shipped as TypeScript there, so plan-review-host imports it through this hook.
 * Register with: node --import ./strip-node-modules-types.mjs
 */

import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";

function filePath(url) {
  const clean = url.split("?")[0].split("#")[0];
  return fileURLToPath(clean);
}

function nodeModulesTypeScript(url) {
  if (!url.startsWith("file:")) return false;
  let path;
  try {
    path = filePath(url);
  } catch {
    return false;
  }
  return path.endsWith(".ts") && path.includes(`${sep}node_modules${sep}`);
}

function strip(source) {
  try {
    return stripTypeScriptTypes(source, { mode: "strip" });
  } catch {
    return stripTypeScriptTypes(source, { mode: "transform" });
  }
}

registerHooks({
  load(url, context, nextLoad) {
    if (!nodeModulesTypeScript(url)) return nextLoad(url, context);
    return {
      format: "module",
      source: strip(readFileSync(filePath(url), "utf8")),
      shortCircuit: true,
    };
  },
});
