import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync(new URL("../dist/ui/", import.meta.url), { recursive: true });
mkdirSync(new URL("../dist/plugin/", import.meta.url), { recursive: true });

const shared = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  external: ["@paperclipai/plugin-sdk", "@paperclipai/plugin-sdk/ui", "react", "react/jsx-runtime"],
};

await build({
  ...shared,
  entryPoints: [new URL("../src/index.ts", import.meta.url).pathname],
  outfile: new URL("../dist/index.js", import.meta.url).pathname,
});
await build({
  ...shared,
  entryPoints: [new URL("../src/ui-parser.ts", import.meta.url).pathname],
  outfile: new URL("../dist/ui-parser.js", import.meta.url).pathname,
});
await build({
  ...shared,
  entryPoints: [new URL("../src/plugin/manifest.ts", import.meta.url).pathname],
  outfile: new URL("../dist/plugin/manifest.js", import.meta.url).pathname,
});
await build({
  ...shared,
  entryPoints: [new URL("../src/plugin/worker.ts", import.meta.url).pathname],
  outfile: new URL("../dist/plugin/worker.js", import.meta.url).pathname,
});
await build({
  ...shared,
  platform: "browser",
  entryPoints: [new URL("../src/plugin/ui.tsx", import.meta.url).pathname],
  outfile: new URL("../dist/ui/index.js", import.meta.url).pathname,
});
