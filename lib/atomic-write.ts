/**
 * Atomic file writes: write to a temp file in the same directory, fsync it,
 * then rename over the destination. A crash or concurrent read never sees a
 * partially written file.
 */
import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

function tmpPathFor(path: string): string {
  return join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

export function writeFileAtomicSync(path: string, data: string | NodeJS.ArrayBufferView, mode?: number): void {
  const tmp = tmpPathFor(path);
  const fd = mode === undefined ? openSync(tmp, "w") : openSync(tmp, "w", mode);
  try {
    writeSync(fd, typeof data === "string" ? Buffer.from(data) : data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
}

export async function writeFileAtomic(path: string, data: string | NodeJS.ArrayBufferView, mode?: number): Promise<void> {
  const tmp = tmpPathFor(path);
  const handle = mode === undefined ? await open(tmp, "w") : await open(tmp, "w", mode);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}
