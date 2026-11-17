import { join, relative } from "node:path";
import { REF_RE } from "@aimem/schema";
import { AimemError } from "../errors.js";
import type { NotebookIndex } from "../index/build.js";
import type { Clock, Fs } from "../ports.js";
import type { Notebook } from "../project/load.js";
import { toPosix } from "../util/path.js";

export const USAGE_LOG_PATH = ".cache/usage.jsonl";
export interface UsageEntry {
  version: 1;
  time: string;
  session: string;
  source: "agent";
  refs: string[];
}

/** Explicit, local usage reports only. Retrieval never reads this cache or learns weights. */
export async function recordUsage(
  nb: Notebook,
  index: NotebookIndex,
  input: { session: string; refs: string[] },
  deps: { fs: Fs; clock: Clock },
): Promise<{ file: string; entry: UsageEntry }> {
  if (typeof input.session !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(input.session))
    throw new AimemError(
      "USAGE",
      "session must be an opaque 1-64 character identifier containing only letters, digits, _ or -",
    );
  if (!input.refs.length || input.refs.length > 100)
    throw new AimemError("USAGE", "provide between 1 and 100 refs");
  const known = new Set(index.records.map((r) => r.id));
  const refs = new Set<string>();
  for (const ref of input.refs) {
    if (!REF_RE.test(ref)) throw new AimemError("USAGE", "invalid record ref");
    const parts = ref.split(":");
    const id = parts.length === 2 ? parts[1] : parts[0];
    if ((parts.length === 2 && parts[0] !== nb.config.project) || !id || !known.has(id))
      throw new AimemError("NOT_FOUND", "usage ref does not resolve in this notebook");
    refs.add(id);
  }
  const entry: UsageEntry = {
    version: 1,
    time: deps.clock.now().toISOString(),
    session: input.session,
    source: "agent",
    refs: [...refs],
  };
  // Fixed path: session and refs can never select a directory or file.
  const path = join(nb.dir, USAGE_LOG_PATH);
  try {
    if (!deps.fs.appendFile) throw new Error("append unavailable");
    await deps.fs.mkdir(join(nb.dir, ".cache"));
    await deps.fs.appendFile(path, `${JSON.stringify(entry)}\n`);
  } catch {
    throw new AimemError("PERMISSION_DENIED", "cannot append local usage log");
  }
  return { file: toPosix(relative(nb.root, path)), entry };
}
