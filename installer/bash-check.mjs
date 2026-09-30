import { checkBashCommand, readUserRules } from "../lib/bash-policy.ts";

/**
 * Print the bash-guard decision for one command.
 * --agent <role> uses the headless subagent floor. Omit it for the main-session floor.
 * @param {{ agentDir: string, bashCommand: string, agentRole?: string | null }} options
 */
export function runBashCheck(options) {
  const loaded = readUserRules(options.agentDir);
  if (loaded.error) console.error(`bash-rules.json: ${loaded.error}`);
  for (const note of loaded.dropped) console.error(`bash-rules.json: ${note}`);
  const headless = Boolean(options.agentRole && options.agentRole !== "main");
  const result = checkBashCommand(options.bashCommand, { headless, rules: loaded.rules });
  console.log(JSON.stringify(result));
  return 0;
}
