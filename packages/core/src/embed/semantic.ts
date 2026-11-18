import type { SemanticInput } from "../context/score.js";
import type { NotebookIndex } from "../index/build.js";
import type { Fs } from "../ports.js";
import type { Notebook } from "../project/load.js";
import { HIDDEN_STATUSES } from "../search/search.js";
import { scanSecrets } from "../secrets/scan.js";
import { loadVectorCache, semanticMatches } from "./cache.js";
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
  const sources =
    provider.id.startsWith("local:") && cache.meta.chunks.some((c) => c.term !== undefined)
      ? new Set(
          index.records
            .filter(
              (r) =>
                !HIDDEN_STATUSES.has(r.status) &&
                !r.tags.includes("no-embed") &&
                scanSecrets(r.text).length === 0 &&
                (!nb.config.repo || !r.repo || r.repo === nb.config.repo || r.repo === "all"),
            )
            .map((r) => r.id),
        )
      : undefined;
  const matches = query.trim()
    ? await semanticMatches(cache, provider, query, sources)
    : { scores: new Map<string, number>() };
  return { ...matches, provider: provider.id, coverage: Math.round(coverage * 10000) / 10000 };
}
