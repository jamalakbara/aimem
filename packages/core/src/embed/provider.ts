import type { ResolvedProject } from "../project/load.js";
import { tokenize } from "../search/bm25.js";
import { createLocalProvider, type ModelLoader } from "./local.js";
import { createOpenAICompatibleProvider, type FetchLike } from "./remote.js";

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

/** Quick, synchronous check: `none` switches semantic search off; an injected provider is used as is. */
export function resolveEmbeddingProvider(
  config: Pick<ResolvedProject, "retrieval">,
  injected?: EmbeddingProvider,
): EmbeddingStatus {
  const provider = config.retrieval?.embeddings?.provider ?? "local";
  if (provider === "none") return { available: false, reason: "retrieval.embeddings.provider is none" };
  if (injected) return { available: true, provider: injected };
  return { available: false, reason: "no embedding provider loaded" };
}

export interface LoadProviderOptions {
  cacheDir: string;
  /** Only `aimem index --embeddings` downloads models. */
  allowDownload: boolean;
  env: Record<string, string | undefined>;
  fetch?: FetchLike;
  loader?: ModelLoader;
  injected?: EmbeddingProvider;
}

/** Build the configured provider (15 §4.2, §11), or say why semantic search is off. Never throws. */
export async function loadEmbeddingProvider(
  config: Pick<ResolvedProject, "retrieval">,
  opts: LoadProviderOptions,
): Promise<EmbeddingStatus> {
  const quick = resolveEmbeddingProvider(config, opts.injected);
  if (quick.available || config.retrieval?.embeddings?.provider === "none") return quick;
  const emb = config.retrieval?.embeddings ?? {};
  try {
    if (emb.provider === "openai-compatible") {
      if (!emb.endpoint || !emb.model)
        return {
          available: false,
          reason: "openai-compatible needs endpoint and model in retrieval.embeddings",
        };
      return {
        available: true,
        provider: await createOpenAICompatibleProvider({
          endpoint: emb.endpoint,
          model: emb.model,
          allowRemote: emb.allow_remote === true,
          fetch: opts.fetch ?? globalThis.fetch,
          ...(opts.env.AIMEM_EMBEDDINGS_KEY ? { apiKey: opts.env.AIMEM_EMBEDDINGS_KEY } : {}),
        }),
      };
    }
    return {
      available: true,
      provider: await createLocalProvider({
        model: emb.model ?? "auto",
        cacheDir: opts.cacheDir,
        allowDownload: opts.allowDownload,
        ...(opts.loader ? { loader: opts.loader } : {}),
      }),
    };
  } catch (e) {
    return { available: false, reason: (e as Error).message };
  }
}
