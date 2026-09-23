import { homedir } from "node:os";
import { join } from "node:path";

/** Agent dir: `PI_CODING_AGENT_DIR`, else `~/.pi/agent`. */
export function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
}
