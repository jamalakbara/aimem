import MiniSearch from "minisearch";
import type { Rec } from "./store.js";

export interface Hit { rec: Rec; raw: number; score: number } // score normalised 0..1

export function lexicalSearch(records: Rec[], query: string, limit = 50): Hit[] {
  const q = query.trim();
  if (!q || records.length === 0) return [];
  const ms = new MiniSearch({
    idField: "id",
    fields: ["title", "summary", "tags", "body"],
    storeFields: [],
    searchOptions: { boost: { title: 3, summary: 2, tags: 1.5 }, prefix: true, fuzzy: 0.15, combineWith: "OR" },
  });
  ms.addAll(records.map((r) => ({ id: r.fm.id, title: r.fm.title, summary: r.fm.summary, tags: (r.fm.tags ?? []).join(" "), body: r.body })));
  const res = ms.search(q).slice(0, limit);
  const max = res[0]?.score ?? 0;
  const byId = new Map(records.map((r) => [r.fm.id, r] as const));
  return res.flatMap((x) => {
    const rec = byId.get(String(x.id));
    return rec ? [{ rec, raw: x.score, score: max > 0 ? x.score / max : 0 }] : [];
  });
}

const STOP = new Set(["the", "a", "an", "of", "to", "and", "or", "for", "in", "on", "with", "is", "are", "we", "use", "using"]);
export function tokens(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1 && !STOP.has(t)));
}
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
