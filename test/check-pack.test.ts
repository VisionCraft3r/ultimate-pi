import assert from "node:assert/strict";
import { test } from "node:test";
import { missingImports } from "../scripts/check-pack.mjs";

function readFrom(files: Record<string, string>) {
  return (path: string) => {
    if (!(path in files)) throw new Error(`no such file: ${path}`);
    return files[path];
  };
}

test("missingImports reports an unpacked relative import", () => {
  const files = {
    "installer/doctor.mjs": `import { x } from "../scripts/x.mjs";\n`,
  };
  const packed = Object.keys(files);
  const problems = missingImports(packed, readFrom(files));
  assert.deepEqual(problems, [{ from: "installer/doctor.mjs", spec: "../scripts/x.mjs" }]);
});

test("missingImports is clean when the target is packed", () => {
  const files = {
    "installer/doctor.mjs": `import { x } from "../scripts/x.mjs";\n`,
    "scripts/x.mjs": `export const x = 1;\n`,
  };
  const packed = Object.keys(files);
  const problems = missingImports(packed, readFrom(files));
  assert.deepEqual(problems, []);
});
