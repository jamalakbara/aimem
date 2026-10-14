/**
 * Min-max normalise semantic scores over the candidate pool (15 §6 "normalised cosine"):
 * embedding models squeeze cosine into a narrow band, so raw values barely separate records.
 * Records without a score stay 0; a single scored record (or a flat band) maps to 1.
 */
export function normaliseSemantic(scores: ReadonlyMap<string, number>, ids: string[]): Map<string, number> {
  const present = ids.filter((id) => (scores.get(id) ?? 0) > 0);
  const values = present.map((id) => scores.get(id) ?? 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const out = new Map<string, number>();
  for (const id of ids) {
    const v = scores.get(id) ?? 0;
    out.set(id, v <= 0 ? 0 : max - min < 1e-9 ? 1 : (v - min) / (max - min));
  }
  return out;
}
