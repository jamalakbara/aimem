import { homedir } from "node:os";
import { join } from "node:path";
import {
  type IndexedRecord,
  loadIndex,
  loadProjectIndex,
  type Notebook,
  type ProjectIndex,
} from "@aimem/core";
import type { CliDeps } from "../deps.js";

/** Where cached sibling checkouts may live (03 §7): `AIMEM_HOME`, else `~/.cache/aimem`. */
export function sourceDeps(deps: CliDeps) {
  return { fs: deps.fs, cacheHome: deps.env.AIMEM_HOME ?? join(homedir(), ".cache", "aimem") };
}

/** Merged read-only index for read commands, plus the local index for vectors and writes. */
export async function readIndexes(
  deps: CliDeps,
  nb: Notebook,
): Promise<{ index: ProjectIndex; local: ProjectIndex | Awaited<ReturnType<typeof loadIndex>> }> {
  const index = await loadProjectIndex(nb, sourceDeps(deps));
  const local = index.sources.length > 1 ? await loadIndex(nb, { fs: deps.fs }) : index;
  return { index, local };
}

/** ` [hub]` / ` [repo:frontend]` after a record's trust label; empty for local records. */
export const notebookTag = (r: IndexedRecord) => (r.notebook ? ` [${r.notebook}]` : "");
