import type { IndexedRecord, NotebookIndex } from "../index/build.js";
import { matchGlob, staticPrefix } from "../util/glob.js";
import { bm25 } from "./bm25.js";

/** 06 §2 step 3: not current, hidden unless asked for. */
export const HIDDEN_STATUSES: ReadonlySet<string> = new Set([
  "superseded",
  "rejected",
  "cancelled",
  "done",
  "retired",
]);

/** Field weights: title and summary boosted (15 §6). */
export const FIELD_BOOSTS = { title: 3, summary: 2, tags: 1.5, body: 1 };

export interface SearchOptions {
  types?: readonly string[];
  /** Explicit statuses; also shows hidden ones that are listed. */
  statuses?: readonly string[];
  tags?: readonly string[];
  /** Records whose roles include one of these, or `all`. */
  roles?: readonly string[];
  repo?: string;
  /** Files or globs; keeps records whose `paths` cover or overlap one of them. */
  paths?: readonly string[];
  includeSuperseded?: boolean;
  limit?: number;
}

export interface SearchHit {
  record: IndexedRecord;
  /** Raw BM25 score. */
  raw: number;
  /** Normalised to the best hit: 0 < score ≤ 1. */
  score: number;
}

function pathsRelated(recordGlobs: readonly string[], wanted: readonly string[]): boolean {
  return recordGlobs.some((g) =>
    wanted.some((w) => {
      if (matchGlob(g, w) || matchGlob(w, g)) return true;
      const [a, b] = [staticPrefix(g), staticPrefix(w)];
      return a.length > 0 && b.length > 0 && (a.startsWith(b) || b.startsWith(a));
    }),
  );
}

export function filterRecords(records: IndexedRecord[], o: SearchOptions): IndexedRecord[] {
  return records.filter(
    (r) =>
      (o.statuses ? o.statuses.includes(r.status) : o.includeSuperseded || !HIDDEN_STATUSES.has(r.status)) &&
      (!o.types || o.types.includes(r.type)) &&
      (!o.tags || o.tags.some((t) => r.tags.includes(t))) &&
      (!o.roles || r.roles.includes("all") || o.roles.some((x) => r.roles.includes(x))) &&
      (!o.repo || r.repo === undefined || r.repo === o.repo || r.repo === "all") &&
      (!o.paths || pathsRelated(r.paths, o.paths)),
  );
}

/** Keyword search with filters. Deterministic: score descending, then id. */
/** Semantic scores for hybrid search (15 §6); filters still apply first. */
export interface SearchSemantic {
  scores: ReadonlyMap<string, number>;
  fusion?: "weighted" | "rrf";
}

const SEMANTIC_TOP_N = 50;

export function search(
  index: NotebookIndex,
  query: string,
  options: SearchOptions = {},
  semantic?: SearchSemantic,
): SearchHit[] {
  const candidates = filterRecords(index.records, options);
  const key = (r: IndexedRecord) => `${r.id}\u0000${r.file}`;
  const raw = bm25(
    candidates.map((r) => ({
      id: key(r),
      fields: { title: r.title, summary: r.summary, tags: r.tags.join(" "), body: r.body },
    })),
    query,
    FIELD_BOOSTS,
  );
  let fused = raw;
  if (semantic) {
    const maxLex = Math.max(0, ...raw.values());
    const lex = new Map(candidates.map((r) => [key(r), maxLex > 0 ? (raw.get(key(r)) ?? 0) / maxLex : 0]));
    const semTop = candidates
      .map((r) => [key(r), Math.min(1, Math.max(0, semantic.scores.get(r.id) ?? 0))] as const)
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, SEMANTIC_TOP_N);
    const sem = new Map(semTop);
    fused = new Map<string, number>();
    if (semantic.fusion === "rrf") {
      const ranked = (m: Map<string, number>) =>
        [...m.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
      for (const m of [lex, sem])
        ranked(m).forEach(([k], rank) => {
          fused.set(k, (fused.get(k) ?? 0) + 1 / (60 + rank + 1));
        });
    } else {
      for (const r of candidates) {
        const v = 0.5 * (lex.get(key(r)) ?? 0) + 0.5 * (sem.get(key(r)) ?? 0);
        if (v > 0) fused.set(key(r), v);
      }
    }
  }
  const hits = candidates.flatMap((r) => {
    const s = fused.get(key(r));
    return s ? [{ record: r, raw: s, score: 0 }] : [];
  });
  hits.sort((a, b) => b.raw - a.raw || (a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0));
  const max = hits[0]?.raw ?? 1;
  return hits.slice(0, options.limit ?? 10).map((h) => ({ ...h, score: h.raw / max }));
}
