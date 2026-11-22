import { AimemError } from "../errors.js";
import { loadIndex } from "../index/build.js";
import { addRecord, type WriteDeps } from "../ops/write.js";
import type { Notebook } from "../project/load.js";
import type { AdoptCandidate, AdoptSource } from "./types.js";

/** 08 §2: an adopted notebook is small and reviewed, not an archive. */
export const ADOPT_DEFAULT_MAX_RECORDS = 40;

export interface AdoptWriteOptions {
  author: string;
  /** Upper limit on new records in this run (default 40). */
  maxRecords?: number;
}

export interface AdoptWritten {
  ref: string;
  file: string;
  type: string;
  title: string;
  source: AdoptSource;
  evidence: string[];
}

export interface AdoptHeld {
  evidence: string;
  title: string;
  reason: string;
}

export interface AdoptWriteResult {
  written: AdoptWritten[];
  /** Candidates whose evidence is already on a record (22 decision 2). */
  alreadyAdopted: number;
  /** Adopted records whose source text now differs; never rewritten, a person decides. */
  sourceChanged: { ref: string; evidence: string[] }[];
  /** Candidates not written: an existing overview, a likely duplicate, or a failed check. */
  held: AdoptHeld[];
  /** New candidates left out by `maxRecords`. */
  cut: number;
  /** Every file written, relative to the notebook root. */
  changed: string[];
  warnings: string[];
}

const evidenceKey = (evidence: readonly string[]) => [...evidence].sort().join("\n");
const norm = (s: string) => s.replace(/\r\n?/g, "\n").trim();

/**
 * Phase B–C of `aimem adopt` (08 §2.1, 22 §4.2): write mechanical drafts as `trust: inferred` records
 * tagged `adopted`, with `evidence`. Idempotent by evidence: a candidate whose evidence is already on a
 * record is never written again. Candidates arrive in priority order (22 decision 4).
 */
export async function writeAdoptDrafts(
  nb: Notebook,
  candidates: readonly AdoptCandidate[],
  opts: AdoptWriteOptions,
  deps: WriteDeps,
): Promise<AdoptWriteResult> {
  const max = opts.maxRecords ?? ADOPT_DEFAULT_MAX_RECORDS;
  if (!Number.isInteger(max) || max < 1) throw new AimemError("USAGE", "--max-records must be at least 1");
  const index = await loadIndex(nb, { fs: deps.fs });
  const byEvidence = new Map<string, (typeof index.records)[number]>();
  for (const r of index.records) {
    const ev = r.fm.evidence;
    if (Array.isArray(ev) && ev.length) byEvidence.set(evidenceKey(ev.map(String)), r);
  }
  const overview = index.records.find(
    (r) => r.tags.includes("pinned") && /overview/i.test(r.title) && r.status !== "superseded",
  );

  const result: AdoptWriteResult = {
    written: [],
    alreadyAdopted: 0,
    sourceChanged: [],
    held: [],
    cut: 0,
    changed: [],
    warnings: [],
  };
  const changed = new Set<string>();
  for (const c of candidates) {
    const existing = byEvidence.get(evidenceKey(c.evidence));
    if (existing) {
      result.alreadyAdopted++;
      if (norm(existing.body) !== norm(c.body))
        result.sourceChanged.push({ ref: existing.id, evidence: c.evidence });
      continue;
    }
    const hold = (reason: string) =>
      result.held.push({ evidence: c.evidence[0] ?? "", title: c.title, reason });
    if (c.tags.includes("pinned") && overview) {
      hold(`the notebook already has a pinned overview (${overview.id}); compare and update it by hand`);
      continue;
    }
    if (result.written.length >= max) {
      result.cut++;
      continue;
    }
    try {
      const w = await addRecord(
        nb,
        {
          type: c.type,
          title: c.title,
          summary: c.summary,
          body: c.body,
          author: opts.author,
          ...(c.status ? { status: c.status } : {}),
          tags: c.tags,
          ...(c.paths ? { paths: c.paths } : {}),
          fields: { evidence: c.evidence, ...(c.kind ? { kind: c.kind } : {}) },
          inferred: true,
        },
        deps,
      );
      for (const f of w.changed) changed.add(f);
      result.warnings.push(...w.warnings.map((x) => `${w.ref}: ${x}`));
      result.written.push({
        ref: w.ref,
        file: w.file,
        type: c.type,
        title: c.title,
        source: c.source,
        evidence: c.evidence,
      });
    } catch (e) {
      if (!(e instanceof AimemError)) throw e;
      if (e.code === "DUPLICATE_LIKELY")
        hold(`likely duplicate of ${String(e.details?.ref)} "${String(e.details?.title)}"`);
      else hold(`${e.code}: ${e.message}`);
    }
  }
  result.changed = [...changed].sort();
  return result;
}
