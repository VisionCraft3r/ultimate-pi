/**
 * Opens a Plannotator plan review in the browser and prints the decision.
 * Spawned with node --experimental-strip-types and --import
 * strip-node-modules-types.mjs. Node 24 will not type-strip files under
 * node_modules, and Plannotator ships TypeScript there.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const planPath = process.argv[2];
const agentDir = process.argv[3];
if (!planPath || !agentDir) {
  process.stderr.write("usage: plan-review-host.ts <plan-path> <agent-dir>\n");
  process.exit(1);
}

const root = join(agentDir, "npm/node_modules/@plannotator/pi-extension");
const { startPlanReviewServer } = await import(pathToFileURL(join(root, "server/serverPlan.ts")).href);
const { getPlanBrowserHtml } = await import(pathToFileURL(join(root, "plannotator-browser-runtime.ts")).href);
const { openBrowser } = await import(pathToFileURL(join(root, "server/network.ts")).href);

const html = getPlanBrowserHtml();
if (!html) {
  process.stderr.write("Plannotator plan UI is not installed.\n");
  process.exit(1);
}

const server = await startPlanReviewServer({
  plan: readFileSync(planPath, "utf8"),
  htmlContent: html,
  origin: "pi",
});
const opened = await openBrowser(server.url);
process.stdout.write(`${JSON.stringify({ url: server.url, opened: opened.opened })}\n`);
const decision = await server.waitForDecision();
server.stop();
process.stdout.write(`${JSON.stringify({ decision })}\n`);
