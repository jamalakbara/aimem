import { buildQuery, type ContextInput, type SemanticInput, scoreCandidates } from "../context/score.js";
import type { NotebookIndex } from "../index/build.js";
import type { LlmProvider } from "../llm/provider.js";
import type { Notebook } from "../project/load.js";
import { type SearchHit, type SearchOptions, type SearchSemantic, search } from "../search/search.js";
import { rewriteQueries } from "./rewrite.js";

export interface QueryDeps {
  llm?: LlmProvider;
  semantic?: SearchSemantic;
  /** Query embeddings are resolved by the adapter; never download a model here. */
  semanticFor?: (query: string) => Promise<SemanticInput | undefined>;
}

/** RRF of original + rewritten searches. With rewriting off/failing, return the exact baseline. */
export async function searchWithRewrites(
  nb: Notebook,
  index: NotebookIndex,
  query: string,
  options: SearchOptions,
  deps: QueryDeps,
): Promise<{ hits: SearchHit[]; warnings: string[] }> {
  const baseline = search(index, query, options, deps.semantic);
  const rewrite = await rewriteQueries(nb, query, deps.llm);
  const warnings = rewrite.warning ? [rewrite.warning] : [];
  if (rewrite.queries.length === 1) return { hits: baseline, warnings };
  try {
    const fused = new Map<string, SearchHit>();
    for (const [i, q] of rewrite.queries.entries()) {
      const semantic = i === 0 ? deps.semantic : await deps.semanticFor?.(q);
      search(index, q, { ...options, limit: 50 }, semantic).forEach((hit, rank) => {
        const previous = fused.get(hit.record.id);
        fused.set(hit.record.id, { ...hit, raw: (previous?.raw ?? 0) + 1 / (60 + rank + 1) });
      });
    }
    const hits = [...fused.values()].sort((a, b) => b.raw - a.raw || a.record.id.localeCompare(b.record.id));
    const max = hits[0]?.raw ?? 1;
    return { hits: hits.slice(0, options.limit ?? 10).map((h) => ({ ...h, score: h.raw / max })), warnings };
  } catch {
    return {
      hits: baseline,
      warnings: [...warnings, "query rewrite retrieval failed; using original query"],
    };
  }
}

/** Max fusion of complete context scores; each query retains the existing metadata/trust policy. */
export async function contextWithRewrites(
  nb: Notebook,
  index: NotebookIndex,
  input: ContextInput,
  now: Date,
  deps: QueryDeps,
): Promise<{ scored: ReturnType<typeof scoreCandidates>; warnings: string[] }> {
  const baseline = scoreCandidates(nb, index, input, now);
  const rewrite = await rewriteQueries(nb, buildQuery(nb, index, input), deps.llm);
  const warnings = rewrite.warning ? [rewrite.warning] : [];
  if (rewrite.queries.length === 1) return { scored: baseline, warnings };
  try {
    const fused = new Map(baseline.candidates.map((c) => [c.record.id, c]));
    for (const q of rewrite.queries.slice(1)) {
      const semantic = await deps.semanticFor?.(q);
      const scored = scoreCandidates(nb, index, { ...input, task: q, semantic }, now);
      for (const c of scored.candidates) {
        const previous = fused.get(c.record.id);
        if (!previous || previous.parts.total < c.parts.total) fused.set(c.record.id, c);
      }
    }
    const candidates = [...fused.values()].sort(
      (a, b) => b.parts.total - a.parts.total || a.record.id.localeCompare(b.record.id),
    );
    return { scored: { ...baseline, candidates }, warnings };
  } catch {
    return {
      scored: baseline,
      warnings: [...warnings, "query rewrite retrieval failed; using original query"],
    };
  }
}
