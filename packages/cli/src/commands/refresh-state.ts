import { join } from "node:path";
import type { Notebook } from "@aimem/core";
import type { CliDeps } from "../deps.js";

/** A lock older than this belongs to a crashed refresh and is ignored. */
export const LOCK_STALE_MS = 10 * 60_000;

/** The background vector refresh's lock file (T1). */
export const refreshLockPath = (nb: Notebook) => join(nb.dir, ".cache", "embed-refresh.lock");

/** False only when the lock names a process that is known to be gone (same machine: `.cache` is local). */
export function lockOwnerAlive(content: string): boolean {
  const pid = Number.parseInt(content, 10);
  if (!Number.isInteger(pid) || pid <= 0) return true; // no pid: fall back to the lock's age
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** True while a background `aimem index --embeddings --background` holds a live lock for this notebook. */
export async function vectorRefreshRunning(deps: CliDeps, nb: Notebook): Promise<boolean> {
  const lock = refreshLockPath(nb);
  const content = await deps.fs.readFile(lock).catch(() => undefined);
  if (content === undefined) return false;
  const mtime = await deps.fs.stat?.(lock).then(
    (s) => s.mtimeMs,
    () => undefined,
  );
  if (mtime === undefined) return false;
  return deps.clock.now().getTime() - mtime < LOCK_STALE_MS && lockOwnerAlive(content);
}

/** The warning for partial semantic coverage in search, context and ask; none at 100%. */
export async function coverageWarning(
  deps: CliDeps,
  nb: Notebook,
  coverage: number,
): Promise<string | undefined> {
  if (coverage >= 1) return undefined;
  if (await vectorRefreshRunning(deps, nb))
    return "semantic index is updating in the background; records written in the last few seconds may rank lower";
  return `semantic index covers ${Math.floor(coverage * 100)}% of records; run aimem index --embeddings`;
}
