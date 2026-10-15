import type { SemanticInput } from "../context/score.js";
import type { NotebookIndex } from "../index/build.js";
import type { Fs } from "../ports.js";
import type { Notebook } from "../project/load.js";
import { loadVectorCache, semanticScores } from "./cache.js";
import type { EmbeddingProvider } from "./provider.js";

/**
 * Semantic scores for a query from the vector cache, with coverage (15 §6, §14), or the reason
 * semantic search cannot be used right now. Never builds the cache itself.
 */
export async function semanticForQuery(
  nb: Notebook,
  index: NotebookIndex,
  provider: EmbeddingProvider,
  query: string,
  deps: { fs: Fs },
): Promise<SemanticInput | { reason: string }> {
  const { cache, problem } = await loadVectorCache(deps.fs, nb);
  if (!cache) return { reason: `${problem ?? "no vector cache"}; run aimem index --embeddings` };
  if (cache.meta.provider !== provider.id || cache.meta.dimensions !== provider.dimensions) {
    return {
      reason: `vector cache was built with a different provider (${cache.meta.provider}); run aimem index --embeddings`,
    };
  }
  const excluded = new Set(cache.meta.excluded ?? []);
  const eligible = index.records.filter((r) => !excluded.has(r.id)).map((r) => r.id);
  const cached = new Set(cache.meta.chunks.map((c) => c.ref));
  const coverage = eligible.length ? eligible.filter((id) => cached.has(id)).length / eligible.length : 1;
  const scores = query.trim() ? await semanticScores(cache, provider, query) : new Map<string, number>();
  return { scores, provider: provider.id, coverage: Math.round(coverage * 10000) / 10000 };
}
