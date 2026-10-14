import { type EmbeddingStatus, type Notebook, resolveEmbeddingProvider } from "@aimem/core";
import type { CliDeps } from "../deps.js";

/** The embedding provider for this notebook: an injected one, else the configured loader. */
export async function embeddingStatus(
  deps: CliDeps,
  nb: Notebook,
  allowDownload: boolean,
): Promise<EmbeddingStatus> {
  if (deps.embedder || nb.config.retrieval?.embeddings?.provider === "none")
    return resolveEmbeddingProvider(nb.config, deps.embedder);
  if (!deps.loadEmbedder) return { available: false, reason: "no embedding provider loaded" };
  return deps.loadEmbedder(nb.config, allowDownload);
}
