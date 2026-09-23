import fs from "node:fs/promises";
import path from "node:path";

/**
 * Timestamped backups of files the installer is about to overwrite.
 * Layout: <agentDir>/backups/ultimate-pi-<ts>/<relative-path>
 * Directories are created only when at least one existing file is copied.
 */
export function createBackupSession(agentDir) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(agentDir, "backups", `ultimate-pi-${stamp}`);
  let created = false;

  return {
    dir,
    async backupIfExists(relPath) {
      const src = path.join(agentDir, relPath);
      try {
        await fs.stat(src);
      } catch (err) {
        if (err.code === "ENOENT") return false;
        throw err;
      }
      if (!created) {
        await fs.mkdir(dir, { recursive: true });
        created = true;
      }
      const dest = path.join(dir, relPath);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(src, dest);
      return true;
    },
  };
}
