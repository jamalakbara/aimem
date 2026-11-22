import {
  createCallLog,
  type EmbeddingProvider,
  type EmbeddingStatus,
  loggedEmbeddingProvider,
  type Notebook,
  resolveEmbeddingProvider,
  vectorCacheProvider,
} from "@aimem/core";
import type { CliDeps } from "../deps.js";
import { sourceDeps } from "./sources.js";

/** The embedding provider for this notebook: an injected one, else the configured loader. */
export async function embeddingStatus(
  deps: CliDeps,
  nb: Notebook,
  allowDownload: boolean,
): Promise<EmbeddingStatus> {
  const status =
    deps.embedder || nb.config.retrieval?.embeddings?.provider === "none"
      ? resolveEmbeddingProvider(nb.config, deps.embedder)
      : deps.loadEmbedder
        ? await deps.loadEmbedder(nb.config, allowDownload)
        : { available: false as const, reason: "no embedding provider loaded" };
  return status.available
    ? { available: true, provider: loggedEmbeddingProvider(status.provider, createCallLog(nb, deps)) }
    : status;
}

/**
 * The provider for refreshing vectors after a write (15 §13), or undefined. Loads the model only
 * when a vector cache already exists, so writes stay fast for notebooks that never built one.
 * Never downloads; a missing model just means no refresh (context and doctor report why).
 */
export async function writeEmbedder(deps: CliDeps, nb: Notebook): Promise<EmbeddingProvider | undefined> {
  if (!(await vectorCacheProvider(deps.fs, nb))) return undefined;
  const status = await embeddingStatus(deps, nb, false);
  return status.available ? status.provider : undefined;
}

/** Deps for core write ops, with the embedder when there is a vector cache to keep current. */
export async function writeDeps(deps: CliDeps, nb: Notebook) {
  const embedder = await writeEmbedder(deps, nb);
  return {
    fs: deps.fs,
    clock: deps.clock,
    random: deps.random,
    cacheHome: sourceDeps(deps).cacheHome,
    ...(embedder ? { embedder } : {}),
  };
}
