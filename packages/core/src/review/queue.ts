import type { IndexedRecord, NotebookIndex } from "../index/build.js";
import { findLikelyDuplicate } from "../ops/write.js";
import type { Notebook } from "../project/load.js";
import { HIDDEN_STATUSES } from "../search/search.js";
import { freshnessOf, RETIRED_STATUSES } from "../validate/validate.js";

export type ReviewReason = "inferred" | "unreviewed" | "stale" | "duplicate";

export interface ReviewItem {
  ref: string;
  type: string;
  status: string;
  trust: string;
  title: string;
  summary: string;
  file: string;
  author: string;
  created: string;
  evidence?: string[];
  /** For "duplicate": the older record this one looks like. */
  duplicateOf?: string;
  reasons: ReviewReason[];
}

/** 08 §2.2 rule 3: inferred records unreviewed for longer than this are review debt. */
export const REVIEW_DEBT_DAYS = 60;

const RANK: Record<ReviewReason, number> = { inferred: 0, unreviewed: 1, stale: 2, duplicate: 3 };

/**
 * Records that need a person's attention (04 §`aimem review`, 22 §4.5): `trust: inferred` drafts first,
 * then unreviewed `agent` records, then stale ones. Local records only; handoffs never need review.
 */
export function reviewQueue(nb: Notebook, index: NotebookIndex, now: Date): ReviewItem[] {
  const items: ReviewItem[] = [];
  const local = index.records.filter((r) => !r.notebook && r.type !== "handoff");
  const older = (a: (typeof local)[number], b: (typeof local)[number]) =>
    a.created < b.created || (a.created === b.created && a.id < b.id);
  for (const r of index.records) {
    if (r.notebook || r.type === "handoff") continue;
    if (HIDDEN_STATUSES.has(r.status) || RETIRED_STATUSES.has(r.status)) continue;
    const reasons: ReviewReason[] = [];
    if (r.trust === "inferred") reasons.push("inferred");
    if (r.trust === "agent") reasons.push("unreviewed");
    if (freshnessOf({ ...r.fm, type: r.type, created: r.created }, nb.config, now) !== "fresh")
      reasons.push("stale");
    // A likely duplicate pair is listed once: the newer record, pointing at the older one.
    const dup = findLikelyDuplicate(
      { records: local.filter((x) => older(x, r)), problems: [] },
      r.type,
      r.title,
      r.summary,
      r.id,
    );
    if (dup) reasons.push("duplicate");
    if (!reasons.length) continue;
    const evidence = Array.isArray(r.fm.evidence) ? r.fm.evidence.map(String) : undefined;
    items.push({
      ref: r.id,
      type: r.type,
      status: r.status,
      trust: r.trust,
      title: r.title,
      summary: r.summary,
      file: r.file,
      author: r.author,
      created: r.created,
      ...(evidence?.length ? { evidence } : {}),
      ...(dup ? { duplicateOf: dup.id } : {}),
      reasons,
    });
  }
  const rank = (i: ReviewItem) => Math.min(...i.reasons.map((x) => RANK[x]));
  return items.sort(
    (a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title) || a.ref.localeCompare(b.ref),
  );
}

/** Inferred records older than REVIEW_DEBT_DAYS and still unreviewed (08 §2.2 rule 3). */
export function reviewDebt(records: readonly IndexedRecord[], now: Date): IndexedRecord[] {
  const limit = now.getTime() - REVIEW_DEBT_DAYS * 86_400_000;
  return records.filter(
    (r) =>
      !r.notebook &&
      r.trust === "inferred" &&
      !RETIRED_STATUSES.has(r.status) &&
      !HIDDEN_STATUSES.has(r.status) &&
      Date.parse(r.created) < limit,
  );
}
