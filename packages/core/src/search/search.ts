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
export function search(index: NotebookIndex, query: string, options: SearchOptions = {}): SearchHit[] {
  const candidates = filterRecords(index.records, options);
  const raw = bm25(
    candidates.map((r) => ({
      id: `${r.id}\u0000${r.file}`,
      fields: { title: r.title, summary: r.summary, tags: r.tags.join(" "), body: r.body },
    })),
    query,
    FIELD_BOOSTS,
  );
  const hits = candidates.flatMap((r) => {
    const s = raw.get(`${r.id}\u0000${r.file}`);
    return s ? [{ record: r, raw: s, score: 0 }] : [];
  });
  hits.sort((a, b) => b.raw - a.raw || (a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0));
  const max = hits[0]?.raw ?? 1;
  return hits.slice(0, options.limit ?? 10).map((h) => ({ ...h, score: h.raw / max }));
}
