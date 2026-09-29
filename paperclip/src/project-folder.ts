import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";

export type FolderPick = {
  status: "idle" | "open" | "chosen" | "cancelled";
  path?: string;
  message?: string;
};

export type PreparedProjectFolder = {
  cwd: string;
  name: string;
  sourceType: "local_path";
};

let pick: FolderPick = { status: "idle" };
let picker: ChildProcess | null = null;

export function projectFolderName(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) throw new Error("Enter a project name.");
  return slug;
}

export function prepareProjectFolder(input: { mode?: string; folder?: string; name?: string }): PreparedProjectFolder {
  const mode = input.mode === "load" ? "load" : "create";
  const folder = typeof input.folder === "string" ? input.folder.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!folder || !isAbsolute(folder)) throw new Error("Choose a folder on this computer.");
  let real: string;
  try {
    real = realpathSync(folder);
  } catch {
    throw new Error("That folder is not on this computer.");
  }
  if (!statSync(real).isDirectory()) throw new Error("That path is not a folder.");
  if (mode === "load") {
    return { cwd: real, name: name || basename(real), sourceType: "local_path" };
  }
  const slug = projectFolderName(name);
  const cwd = join(real, slug);
  if (existsSync(cwd)) {
    if (readdirSync(cwd).length > 0) {
      throw new Error("A folder with that project name already has files. Load it as an existing project instead.");
    }
  } else {
    mkdirSync(cwd);
  }
  return { cwd, name, sourceType: "local_path" };
}

export function beginFolderPick(prompt: string): FolderPick {
  if (pick.status === "open") return pick;
  pick = { status: "open" };
  const safe = prompt.replace(/["\\]/g, "").slice(0, 120) || "Select a folder";
  let out = "";
  let err = "";
  picker = spawn("osascript", ["-e", `POSIX path of (choose folder with prompt "${safe}")`], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  picker.stdout?.setEncoding("utf8");
  picker.stderr?.setEncoding("utf8");
  picker.stdout?.on("data", (chunk) => {
    out += chunk;
  });
  picker.stderr?.on("data", (chunk) => {
    err += chunk;
  });
  picker.on("close", (code) => {
    picker = null;
    if (code === 0) {
      const path = out.trim().replace(/\/$/, "");
      pick = path ? { status: "chosen", path } : { status: "cancelled", message: "Folder selection was cancelled." };
      return;
    }
    const cancelled = /user cancel/i.test(err) || /-128/.test(err);
    pick = {
      status: "cancelled",
      message: cancelled ? "Folder selection was cancelled." : err.trim() || "Could not open the folder picker.",
    };
  });
  return pick;
}

export function readFolderPick(): FolderPick {
  return pick;
}
