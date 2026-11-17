import {
  createCallLog,
  loggedLlmProvider,
  type Notebook,
  type NotebookIndex,
  type QueryDeps,
} from "@aimem/core";
import type { CliDeps } from "../deps.js";
import { type Mode, semanticFor } from "./semantic.js";

/** Optional providers are loaded only when their feature is enabled. Never downloads. */
export async function retrievalDeps(
  deps: CliDeps,
  nb: Notebook,
  index: NotebookIndex,
  mode: Mode,
): Promise<QueryDeps> {
  const result: QueryDeps = {
    now: deps.clock.now(),
    semanticFor: async (query) => (await semanticFor(deps, nb, index, query, mode, false)).semantic,
  };
  if (nb.config.retrieval?.query_rewrite === "llm" && nb.config.retrieval.llm?.allow_remote === true) {
    const status = deps.loadLlm?.(nb.config);
    if (status?.available) result.llm = loggedLlmProvider(status.provider, createCallLog(nb, deps));
  }
  if (nb.config.retrieval?.rerank === "cross-encoder") {
    try {
      const status = await deps.loadRanker?.(false);
      if (status?.available) {
        const provider = status.provider;
        const log = createCallLog(nb, deps);
        result.ranker = {
          id: provider.id,
          score: (question, docs) =>
            log.run({ kind: "rerank.local", id: provider.id, refCount: docs.length }, () =>
              provider.score(question, docs),
            ),
        };
      }
    } catch {
      /* Core reports unavailable and preserves the baseline. */
    }
  }
  return result;
}
