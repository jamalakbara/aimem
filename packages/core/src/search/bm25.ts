/** Lowercase, accent-folded word tokens; no stemming or stopwords so any language works (OQ-15). */
export function tokenize(text: string): string[] {
  return (
    text
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).filter((t) => t.length > 1 || /\d/.test(t));
}

export interface Bm25Doc {
  id: string;
  fields: Record<string, string>;
}

const K1 = 1.2;
const B = 0.75;

/**
 * BM25 over boosted fields (term frequencies and lengths are summed with field weights).
 * Returns raw scores > 0 only.
 */
export function bm25(docs: Bm25Doc[], query: string, boosts: Record<string, number>): Map<string, number> {
  const terms = [...new Set(tokenize(query))];
  const scores = new Map<string, number>();
  if (!terms.length || !docs.length) return scores;
  const tf: Map<string, number>[] = [];
  const len: number[] = [];
  const df = new Map<string, number>();
  for (const d of docs) {
    const counts = new Map<string, number>();
    let l = 0;
    for (const [field, text] of Object.entries(d.fields)) {
      const w = boosts[field] ?? 1;
      for (const t of tokenize(text)) {
        counts.set(t, (counts.get(t) ?? 0) + w);
        l += w;
      }
    }
    tf.push(counts);
    len.push(l);
    for (const t of terms) if (counts.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const avg = len.reduce((a, b) => a + b, 0) / docs.length || 1;
  docs.forEach((d, i) => {
    let s = 0;
    for (const t of terms) {
      const f = tf[i]?.get(t) ?? 0;
      if (!f) continue;
      const n = df.get(t) ?? 0;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      s += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * (len[i] ?? 0)) / avg));
    }
    if (s > 0) scores.set(d.id, s);
  });
  return scores;
}
