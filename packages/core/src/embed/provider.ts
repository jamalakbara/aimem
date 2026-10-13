import type { ResolvedProject } from "../project/load.js";
import { tokenize } from "../search/bm25.js";

/** 15 §4.1. */
export interface EmbeddingProvider {
  /** e.g. `local:<model>`; part of the cache identity. */
  id: string;
  dimensions: number;
  maxInputTokens: number;
  embed(texts: string[], kind: "document" | "query"): Promise<number[][]>;
}

export type EmbeddingStatus =
  | { available: true; provider: EmbeddingProvider }
  | { available: false; reason: string };

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic stub (feature hashing of words, L2-normalised). For tests and offline
 * development only: it captures word overlap, not meaning (12 §3).
 */
export function hashEmbedder(dimensions = 256, variant?: string): EmbeddingProvider {
  return {
    id: `stub:hash-${dimensions}${variant ? `:${variant}` : ""}`,
    dimensions,
    maxInputTokens: 512,
    async embed(texts) {
      return texts.map((t) => {
        const v = new Array<number>(dimensions).fill(0);
        for (const tok of tokenize(t)) {
          const h = fnv1a(`${variant ?? ""}${tok}`);
          v[h % dimensions] = (v[h % dimensions] ?? 0) + ((h >>> 16) & 1 ? 1 : -1);
        }
        const norm = Math.hypot(...v) || 1;
        return v.map((x) => x / norm);
      });
    },
  };
}

/**
 * Pick the embedding provider from `retrieval.embeddings` (15 §4.2). `injected` is used by
 * tests (and later by the local model). Without one, semantic search is off with a reason.
 */
export function resolveEmbeddingProvider(
  config: Pick<ResolvedProject, "retrieval">,
  injected?: EmbeddingProvider,
): EmbeddingStatus {
  const provider = config.retrieval?.embeddings?.provider ?? "local";
  if (provider === "none") return { available: false, reason: "retrieval.embeddings.provider is none" };
  if (injected) return { available: true, provider: injected };
  if (provider === "openai-compatible")
    return { available: false, reason: "the openai-compatible provider arrives in slice 2.4" };
  return { available: false, reason: "the local embedding model arrives in slice 2.4" };
}
