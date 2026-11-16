/** Eval-only response validation. Invalid output means retain the baseline order. */
export function parseRerankOrder(text: string, candidates: string[], limit: number): string[] | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!Array.isArray(value) || value.length !== Math.min(limit, candidates.length)) return undefined;
  const allowed = new Set(candidates);
  if (value.some((ref) => typeof ref !== "string" || !allowed.has(ref))) return undefined;
  const selected = new Set(value as string[]);
  if (selected.size !== value.length) return undefined;
  return [...(value as string[]), ...candidates.filter((ref) => !selected.has(ref))];
}
