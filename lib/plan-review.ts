import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type PlanDecision = {
  approved: boolean;
  feedback?: string;
  url?: string;
  error?: string;
};

const HOST = fileURLToPath(new URL("./plan-review-host.ts", import.meta.url));
const TYPE_STRIP_LOADER = fileURLToPath(new URL("./strip-node-modules-types.mjs", import.meta.url));

export async function reviewPlanInBrowser(
  planPath: string,
  agentDir: string,
  launch: typeof spawn = spawn,
): Promise<PlanDecision> {
  if (!existsSync(planPath)) return { approved: false, error: `Plan file not found: ${planPath}` };
  if (!existsSync(join(agentDir, "npm/node_modules/@plannotator/pi-extension/package.json"))) {
    return { approved: false, error: "Plannotator is not installed in the Pi agent dir." };
  }
  return await new Promise((resolve) => {
    const child = launch(
      process.execPath,
      ["--experimental-strip-types", "--import", TYPE_STRIP_LOADER, HOST, planPath, agentDir],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    let url: string | undefined;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      for (const line of chunk.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as { url?: string };
          if (parsed.url) url = parsed.url;
        } catch {
          // partial line
        }
      }
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err) => resolve({ approved: false, error: err.message, url }));
    child.on("close", (code) => {
      let decision: { approved?: boolean; feedback?: string } | undefined;
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as { decision?: { approved?: boolean; feedback?: string }; url?: string };
          if (parsed.url) url = parsed.url;
          if (parsed.decision) decision = parsed.decision;
        } catch {
          // ignore non-json logs
        }
      }
      if (!decision) {
        resolve({ approved: false, url, error: stderr.trim() || `Plannotator exited ${code}` });
        return;
      }
      resolve({ approved: Boolean(decision.approved), feedback: decision.feedback, url });
    });
  });
}
