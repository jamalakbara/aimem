import { basename, dirname, join } from "node:path";
import { STATUSES } from "@aimem/schema";
import { type IndexedRecord, loadIndex } from "../index/build.js";
import type { WriteDeps } from "../ops/write.js";
import type { Notebook } from "../project/load.js";
import { recordFileName } from "../records/ids.js";
import { readRecordFile, writeRecordFile } from "../records/store.js";
import { setField } from "../records/text.js";
import { writeIndexMd } from "../render/index-md.js";

export interface FixResult {
  fixed: { code: string; file: string; action: string }[];
  skipped: { code: string; file: string; reason: string }[];
}

const iso = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/**
 * `aimem validate --fix` (04): only safe repairs. V015 renames, one-sided V007 links get
 * their missing half, `updated` earlier than `created` is raised. Never deletes or overwrites.
 */
export async function fixNotebook(nb: Notebook, deps: WriteDeps): Promise<FixResult> {
  const result: FixResult = { fixed: [], skipped: [] };
  const exists = (p: string) =>
    deps.fs.readFile(p).then(
      () => true,
      () => false,
    );

  // V015: file name must start with the id.
  let index = await loadIndex(nb, { fs: deps.fs });
  for (const r of index.records) {
    if (basename(r.file).startsWith(`${r.id}-`)) continue;
    const target = join(
      dirname(r.file),
      recordFileName({ id: r.id, type: r.type, title: r.title, created: r.created }),
    );
    if (await exists(join(nb.root, target))) {
      result.skipped.push({ code: "V015", file: r.file, reason: `target ${target} already exists` });
      continue;
    }
    await deps.fs.rename(join(nb.root, r.file), join(nb.root, target));
    result.fixed.push({ code: "V015", file: r.file, action: `renamed to ${target}` });
  }

  // V007 and `updated`, on the renamed tree.
  index = await loadIndex(nb, { fs: deps.fs });
  const byId = new Map<string, IndexedRecord>();
  for (const r of index.records) if (!byId.has(r.id)) byId.set(r.id, r);
  const local = (ref: string | undefined) =>
    ref && !ref.includes(":") ? byId.get(ref) : ref ? byId.get(ref.split(":")[1] ?? "") : undefined;
  const now = iso(deps.clock.now());
  const edits = new Map<string, { sets: [string, string][]; notes: string[]; code: string }>();
  const edit = (r: IndexedRecord, code: string, sets: [string, string][], note: string) => {
    const e = edits.get(r.file) ?? { sets: [], notes: [], code };
    e.sets.push(...sets);
    e.notes.push(note);
    edits.set(r.file, e);
  };
  for (const a of index.records) {
    const b = local(str(a.fm.supersedes));
    if (b && b.fm.superseded_by === undefined) {
      const canSupersede = (STATUSES[b.type] as readonly string[]).includes("superseded");
      const sets: [string, string][] = [
        ["superseded_by", a.id],
        ...(canSupersede && b.status !== "superseded" ? [["status", "superseded"] as [string, string]] : []),
      ];
      edit(b, "V007", [...sets, ["updated", now]], `set ${sets.map(([k, v]) => `${k}: ${v}`).join(", ")}`);
    }
    const c = local(str(a.fm.superseded_by));
    if (c && c.fm.supersedes === undefined)
      edit(
        c,
        "V007",
        [
          ["supersedes", a.id],
          ["updated", now],
        ],
        `set supersedes: ${a.id}`,
      );
  }
  for (const r of index.records) {
    if (r.updated < r.created && !edits.has(r.file))
      edit(r, "updated", [["updated", r.created]], `set updated: ${r.created}`);
  }
  for (const [file, e] of edits) {
    const parsed = await readRecordFile(deps.fs, join(nb.root, file));
    if (!parsed.ok) continue;
    for (const [k, v] of e.sets) setField(parsed.record, k, v);
    await writeRecordFile(deps.fs, join(nb.root, file), parsed.record, deps.random);
    result.fixed.push({ code: e.code, file, action: e.notes.join("; ") });
  }
  if (result.fixed.length) await writeIndexMd(deps.fs, nb, await loadIndex(nb, { fs: deps.fs }), deps.random);
  return result;
}
