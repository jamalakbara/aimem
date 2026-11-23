import type { IndexedRecord, NotebookIndex } from "../index/build.js";
import type { Notebook } from "../project/load.js";
import { tokenize } from "../search/bm25.js";
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
  /** Owned by an external source (16 §2): edited there, not here. */
  externalSystem?: string;
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
  const pool = index.records.filter(
    (r) =>
      !r.notebook &&
      r.type !== "handoff" &&
      !HIDDEN_STATUSES.has(r.status) &&
      !RETIRED_STATUSES.has(r.status),
  );
  const dups = likelyDuplicates(pool);
  for (const r of index.records) {
    if (r.notebook || r.type === "handoff") continue;
    if (HIDDEN_STATUSES.has(r.status) || RETIRED_STATUSES.has(r.status)) continue;
    const reasons: ReviewReason[] = [];
    if (r.trust === "inferred") reasons.push("inferred");
    if (r.trust === "agent") reasons.push("unreviewed");
    if (freshnessOf({ ...r.fm, type: r.type, created: r.created }, nb.config, now) !== "fresh")
      reasons.push("stale");
    // A likely duplicate pair is listed once: the newer record, pointing at the older one.
    const dupId = dups.get(r.id);
    const dup = dupId ? { id: dupId } : undefined;
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
      ...(r.fm.managed_by === "external"
        ? {
            externalSystem: String(
              (r.fm.source as { system?: string } | undefined)?.system ?? "an external source",
            ),
          }
        : {}),
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

export interface DuplicateInput {
  id: string;
  type: string;
  title: string;
  summary: string;
  created: string;
  tags: readonly string[];
}

/**
 * Likely duplicates with the same rule as \`add\` (title overlap ≥ 0.7, or title + summary ≥ 0.5), in
 * one pass: each record is compared only with older records of its type that share a token, through
 * an inverted index. Returns newer id → the oldest matching id. Two adopted drafts are never paired:
 * they are told apart by evidence, and template ADRs share most of their words (QA, #96).
 */
export function likelyDuplicates(records: readonly DuplicateInput[]): Map<string, string> {
  const sorted = [...records].sort((a, b) =>
    a.created < b.created ? -1 : a.created > b.created ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const titles: Set<string>[] = [];
  const alls: Set<string>[] = [];
  const byTitle = new Map<string, number[]>();
  const byAll = new Map<string, number[]>();
  const add = (m: Map<string, number[]>, k: string, i: number) => {
    const list = m.get(k);
    if (list) list.push(i);
    else m.set(k, [i]);
  };
  const out = new Map<string, string>();
  sorted.forEach((r, i) => {
    const t = new Set(tokenize(r.title));
    const a = new Set(tokenize(`${r.title} ${r.summary}`));
    titles[i] = t;
    alls[i] = a;
    const adopted = r.tags.includes("adopted");
    let best: number | undefined;
    const check = (
      index: Map<string, number[]>,
      set: Set<string>,
      sets: Set<string>[],
      threshold: number,
    ) => {
      const shared = new Map<number, number>();
      for (const tok of set)
        for (const j of index.get(`${r.type}\u0000${tok}`) ?? []) shared.set(j, (shared.get(j) ?? 0) + 1);
      for (const [j, n] of shared) {
        if (adopted && sorted[j]?.tags.includes("adopted")) continue;
        const other = sets[j]?.size ?? 0;
        if (n / (set.size + other - n) >= threshold && (best === undefined || j < best)) best = j;
      }
    };
    if (t.size) check(byTitle, t, titles, 0.7);
    if (a.size) check(byAll, a, alls, 0.5);
    if (best !== undefined) out.set(r.id, sorted[best]?.id ?? "");
    for (const tok of t) add(byTitle, `${r.type}\u0000${tok}`, i);
    for (const tok of a) add(byAll, `${r.type}\u0000${tok}`, i);
  });
  return out;
}

/**
 * A reusable duplicate check for many lookups against one fixed set of records (imports): the same rule
 * as \`add\`, through an inverted token index built once instead of a full scan per lookup.
 */
export function duplicateFinder<T extends DuplicateInput>(
  records: readonly T[],
): (type: string, title: string, summary: string) => T | undefined {
  const titles: Set<string>[] = [];
  const alls: Set<string>[] = [];
  const byTitle = new Map<string, number[]>();
  const byAll = new Map<string, number[]>();
  const put = (m: Map<string, number[]>, k: string, i: number) => {
    const list = m.get(k);
    if (list) list.push(i);
    else m.set(k, [i]);
  };
  records.forEach((r, i) => {
    titles[i] = new Set(tokenize(r.title));
    alls[i] = new Set(tokenize(`${r.title} ${r.summary}`));
    for (const t of titles[i] ?? []) put(byTitle, `${r.type}\u0000${t}`, i);
    for (const t of alls[i] ?? []) put(byAll, `${r.type}\u0000${t}`, i);
  });
  return (type, title, summary) => {
    const t = new Set(tokenize(title));
    const a = new Set(tokenize(`${title} ${summary}`));
    let best: number | undefined;
    const check = (
      index: Map<string, number[]>,
      set: Set<string>,
      sets: Set<string>[],
      threshold: number,
    ) => {
      const shared = new Map<number, number>();
      for (const tok of set)
        for (const j of index.get(`${type}\u0000${tok}`) ?? []) shared.set(j, (shared.get(j) ?? 0) + 1);
      for (const [j, n] of shared)
        if (n / (set.size + (sets[j]?.size ?? 0) - n) >= threshold && (best === undefined || j < best))
          best = j;
    };
    if (t.size) check(byTitle, t, titles, 0.7);
    if (a.size) check(byAll, a, alls, 0.5);
    return best === undefined ? undefined : records[best];
  };
}
