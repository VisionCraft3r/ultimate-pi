/**
 * Isolate every `pi` subprocess (and this process) onto the installer agent dir.
 * --offline also sets PI_OFFLINE so Pi itself skips startup network.
 */
export function bindAgentDir(options = {}) {
  if (options.agentDir) {
    process.env.PI_CODING_AGENT_DIR = options.agentDir;
  }
  if (options.offline) {
    process.env.PI_OFFLINE = "1";
  }
}

export function piEnv(options = {}) {
  const env = { ...process.env };
  if (options.agentDir) env.PI_CODING_AGENT_DIR = options.agentDir;
  if (options.offline) env.PI_OFFLINE = "1";
  return env;
}
