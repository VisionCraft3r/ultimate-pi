export const type = "ultimate_pi";
export const label = "Ultimate PI";

export const models: Array<{ id: string; label: string }> = [];

export const agentConfigurationDoc = `# ultimate_pi
Use when the company should run Ultimate PI, not a single-provider harness.
Core fields: persona, cwd, agentDir, timeoutSec.
`;

export { createServerAdapter } from "./server/index.ts";
