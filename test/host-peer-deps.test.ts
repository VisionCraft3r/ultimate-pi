import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { rewriteHostPeerDeps } from "../installer/host-peer-deps.mjs";

test("an extension's host dependencies become peerDependencies and nested copies are removed", () => {
  const agentDir = join(tmpdir(), `host-peer-${process.pid}`);
  const extension = join(agentDir, "npm", "node_modules", "remote-pi");
  const nested = join(extension, "node_modules", "@earendil-works", "pi-tui");
  const plain = join(agentDir, "npm", "node_modules", "plain-lib");
  rmSync(agentDir, { recursive: true, force: true });
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "package.json"), "{\"name\":\"@earendil-works/pi-tui\"}\n");
  writeFileSync(
    join(extension, "package.json"),
    `${JSON.stringify({
      name: "remote-pi",
      pi: { extensions: ["./dist"] },
      dependencies: {
        "@earendil-works/pi-coding-agent": "^0.79.10",
        "@earendil-works/pi-tui": "^0.79.10",
        typebox: "^1.1.38",
        ws: "^8.21.0",
      },
      peerDependencies: { zod: "^4.0.0" },
    }, null, 2)}\n`,
  );
  mkdirSync(plain, { recursive: true });
  writeFileSync(
    join(plain, "package.json"),
    `${JSON.stringify({ name: "plain-lib", dependencies: { typebox: "^1.0.0" } }, null, 2)}\n`,
  );

  const result = rewriteHostPeerDeps(agentDir);
  assert.deepEqual(result.rewritten, ["remote-pi"]);
  const manifest = JSON.parse(readFileSync(join(extension, "package.json"), "utf8"));
  assert.deepEqual(manifest.dependencies, { ws: "^8.21.0" });
  assert.equal(manifest.peerDependencies["@earendil-works/pi-coding-agent"], "*");
  assert.equal(manifest.peerDependencies["@earendil-works/pi-tui"], "*");
  assert.equal(manifest.peerDependencies.typebox, "*");
  assert.equal(manifest.peerDependencies.zod, "^4.0.0");
  assert.equal(existsSync(nested), false);
  assert.equal(existsSync(join(extension, "node_modules", "@earendil-works")), false);
  assert.deepEqual(
    JSON.parse(readFileSync(join(plain, "package.json"), "utf8")).dependencies,
    { typebox: "^1.0.0" },
  );

  const again = rewriteHostPeerDeps(agentDir);
  assert.deepEqual(again.rewritten, []);
  rmSync(agentDir, { recursive: true, force: true });
});
