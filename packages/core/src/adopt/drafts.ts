import { AimemError } from "../errors.js";
import { loadIndex } from "../index/build.js";
import { addRecord, discardedKey, loadDiscarded, type WriteDeps } from "../ops/write.js";
import type { Notebook } from "../project/load.js";
import { tokenize } from "../search/bm25.js";
import { RETIRED_STATUSES } from "../validate/validate.js";
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
  /** Candidates a person discarded before (listed in `.aimem/adopt-discarded`). */
  discarded: number;
  /** Every file written, relative to the notebook root. */
  changed: string[];
  warnings: string[];
}

const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
};

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
  // Drafts are told apart by evidence, so the duplicate check only looks at records a person or agent
  // wrote, and only at titles: ADR templates share most of their summary wording (QA, #88 review).
  const ownRecords = index.records
    .filter(
      (r) => !r.tags.includes("adopted") && !RETIRED_STATUSES.has(r.status) && r.status !== "superseded",
    )
    .map((r) => ({ r, tokens: new Set(tokenize(r.title)) }));
  const duplicateOf = (c: AdoptCandidate) => {
    const t = new Set(tokenize(c.title));
    return ownRecords.find((o) => o.r.type === c.type && jaccard(t, o.tokens) >= 0.7)?.r;
  };
  const overview = index.records.find(
    (r) => r.tags.includes("pinned") && /overview/i.test(r.title) && r.status !== "superseded",
  );

  const result: AdoptWriteResult = {
    written: [],
    alreadyAdopted: 0,
    sourceChanged: [],
    held: [],
    cut: 0,
    discarded: 0,
    changed: [],
    warnings: [],
  };
  const changed = new Set<string>();
  const discarded = await loadDiscarded(deps.fs, nb.dir);
  for (const c of candidates) {
    if (discarded.has(discardedKey(c.evidence))) {
      result.discarded++;
      continue;
    }
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
    const dup = duplicateOf(c);
    if (dup) {
      hold(`likely duplicate of ${dup.id} "${dup.title}"`);
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
          force: true,
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
      hold(`${e.code}: ${e.message}`);
    }
  }
  result.changed = [...changed].sort();
  return result;
}

/** Candidates whose evidence is not on any record yet (the ones `--agent-plan` hands to an agent). */
export function pendingCandidates(
  records: readonly { fm: Record<string, unknown> }[],
  candidates: readonly AdoptCandidate[],
): { pending: AdoptCandidate[]; alreadyAdopted: number } {
  const taken = new Set(
    records
      .map((r) => r.fm.evidence)
      .filter((ev): ev is unknown[] => Array.isArray(ev) && ev.length > 0)
      .map((ev) => evidenceKey(ev.map(String))),
  );
  const pending = candidates.filter((c) => !taken.has(evidenceKey(c.evidence)));
  return { pending, alreadyAdopted: candidates.length - pending.length };
}
