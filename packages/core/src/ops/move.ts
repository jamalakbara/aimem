import { join } from "node:path";
import { AimemError } from "../errors.js";
import { loadIndex } from "../index/build.js";
import type { Notebook } from "../project/load.js";
import { resolveSources, type SourceDeps } from "../project/sources.js";
import { writeFileAtomic, writeRecordFile } from "../records/store.js";
import { parseRecordText, setBody, setField } from "../records/text.js";
import { writeIndexMd } from "../render/index-md.js";
import type { WriteDeps } from "./write.js";

export interface MoveResult {
  ref: string;
  /** `hub` or `repo:<name>`. */
  to: string;
  /** Notebook root that received the record. */
  targetRoot: string;
  /** Files changed in the target notebook, relative to its root. */
  targetChanged: string[];
  /** Files changed here (the stub and INDEX.md). */
  changed: string[];
}

/**
 * `aimem move <ref> --to hub|<repo>` (04 §4, 03 §7): copy a record into another notebook of the
 * project with the same ID and text, and turn the local file into a pointer stub (`moved_to`,
 * status unchanged, body replaced by a link). Reads prefer the moved record over the stub.
 */
export async function moveRecord(
  nb: Notebook,
  ref: string,
  to: string,
  deps: WriteDeps & SourceDeps,
): Promise<MoveResult> {
  const i = ref.indexOf(":");
  if (i >= 0 && ref.slice(0, i) !== nb.config.project)
    throw new AimemError("NOT_FOUND", `record ${ref} is not in project ${nb.config.project}`);
  const id = i >= 0 ? ref.slice(i + 1) : ref;
  const rec = (await loadIndex(nb, deps)).records.find((r) => r.id === id);
  if (!rec)
    throw new AimemError("NOT_FOUND", `record ${ref} is not in this notebook; run move where it lives`);
  if (typeof rec.fm.moved_to === "string")
    throw new AimemError("USAGE", `${id} was already moved to ${rec.fm.moved_to}`);
  if (rec.fm.managed_by === "external")
    throw new AimemError("READONLY_EXTERNAL", `${id} is owned by an external source; move it there`);

  const sources = await resolveSources(nb, deps);
  const target = sources.find((s) => (to === "hub" ? s.kind === "hub" : s.kind === "repo" && s.name === to));
  if (!target) {
    const names = sources.filter((s) => s.kind !== "local").map((s) => (s.kind === "hub" ? "hub" : s.name));
    throw new AimemError("USAGE", `unknown move target '${to}' (configured: ${names.join(", ") || "none"})`);
  }
  const label = target.label ?? target.name;
  if (target.status !== "ok" || !target.nb || !target.root)
    throw new AimemError("USAGE", `${label} is not available: ${target.reason ?? "not readable"}`);
  if ((await loadIndex(target.nb, deps)).records.some((r) => r.id === id))
    throw new AimemError("INVALID_RECORD", `${label} already has a record ${id}`);

  // 1. The record keeps its ID and text in the target notebook.
  await writeFileAtomic(deps.fs, join(target.root, rec.file), rec.text, deps.random);
  const targetChanged = [rec.file];
  if (await writeIndexMd(deps.fs, target.nb, await loadIndex(target.nb, deps), deps.random))
    targetChanged.push(".aimem/INDEX.md");

  // 2. The local file becomes a pointer stub; reads resolve to the moved record (03 §7).
  const parsed = parseRecordText(rec.text);
  if (!parsed.ok) throw new AimemError("INVALID_RECORD", `${rec.file}: ${parsed.message}`);
  const stub = parsed.record;
  setField(stub, "moved_to", label);
  setField(stub, "updated", `${deps.clock.now().toISOString().slice(0, 19)}Z`);
  setBody(
    stub,
    `Moved to ${label}. Open it with \`aimem show ${nb.config.project}:${id}\`. If this machine has no copy of ${label}, check it out next to this repo or in the aimem cache.`,
  );
  await writeRecordFile(deps.fs, join(nb.root, rec.file), stub, deps.random);
  const changed = [rec.file];
  if (await writeIndexMd(deps.fs, nb, await loadIndex(nb, deps), deps.random))
    changed.push(".aimem/INDEX.md");
  return { ref: id, to: label, targetRoot: target.root, targetChanged, changed };
}
