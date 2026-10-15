import {
  AimemError,
  type Notebook,
  type NotebookIndex,
  type SemanticInput,
  semanticForQuery,
} from "@aimem/core";
import type { CliDeps } from "../deps.js";
import { embeddingStatus } from "./embedder.js";

export type Mode = "lexical" | "hybrid";

/** `--mode` flag, else `retrieval.mode`, else hybrid (03 §6, 15 §11). */
export function retrievalMode(nb: Notebook, flag: string | undefined): Mode {
  const mode = flag ?? nb.config.retrieval?.mode ?? "hybrid";
  if (mode !== "lexical" && mode !== "hybrid")
    throw new AimemError("USAGE", `--mode must be lexical or hybrid (got '${mode}')`);
  return mode;
}

/**
 * Semantic scores for a query when the mode, provider and vector cache allow it; otherwise the
 * reason it is off. Warns only when hybrid was explicitly requested (15 §14: fall back, say why).
 */
export async function semanticFor(
  deps: CliDeps,
  nb: Notebook,
  index: NotebookIndex,
  query: string,
  mode: Mode,
  explicit: boolean,
): Promise<{ semantic?: SemanticInput; off?: string; warnings: string[] }> {
  if (mode === "lexical") return { off: "lexical mode", warnings: [] };
  const status = await embeddingStatus(deps, nb, false);
  const result = status.available
    ? await semanticForQuery(nb, index, status.provider, query, { fs: deps.fs })
    : { reason: status.reason };
  if ("scores" in result) return { semantic: result, warnings: [] };
  return {
    off: result.reason,
    warnings: explicit ? [`hybrid retrieval unavailable (${result.reason}); using lexical`] : [],
  };
}
