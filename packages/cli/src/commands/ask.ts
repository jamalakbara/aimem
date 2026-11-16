import {
  AimemError,
  askQuestion,
  createCallLog,
  loadIndex,
  loadProject,
  loggedLlmProvider,
} from "@aimem/core";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";
import { retrievalMode, semanticFor } from "./semantic.js";

const HOW_TO_ENABLE =
  "set retrieval.llm.provider: claude-cli and retrieval.llm.allow_remote: true in .aimem/project.yaml (uses your Claude Code login; record text goes to Anthropic)";

/** `aimem ask` (04 §2, 15 §10). Read-only. */
export async function ask(
  deps: CliDeps,
  g: GlobalOptions,
  question: string,
  o: { role?: string; limit?: number; mode?: string },
): Promise<CommandResult> {
  if (!question.trim()) throw new AimemError("USAGE", "the question is empty");
  const nb = await loadProject(deps.fs, g.dir);
  const status = deps.loadLlm
    ? deps.loadLlm(nb.config)
    : { available: false as const, reason: "no LLM provider loaded" };
  if (!status.available)
    throw new AimemError(
      "LLM_FAILED",
      `aimem ask needs an LLM (${status.reason}); to enable: ${HOW_TO_ENABLE}`,
      {
        reason: status.reason,
      },
    );
  const index = await loadIndex(nb, { fs: deps.fs });
  const mode = retrievalMode(nb, o.mode);
  const sem = await semanticFor(deps, nb, index, question, mode, o.mode !== undefined);
  const r = await askQuestion(nb, index, question.trim(), {
    llm: loggedLlmProvider(status.provider, createCallLog(nb, deps)),
    ...(o.limit ? { limit: o.limit } : {}),
    ...(o.role ? { role: o.role } : {}),
    ...(sem.semantic
      ? {
          semantic: {
            scores: sem.semantic.scores,
            fusion: nb.config.retrieval?.fusion === "rrf" ? ("rrf" as const) : ("weighted" as const),
          },
        }
      : {}),
  });
  const data = {
    question: r.question,
    answer: r.answer,
    found: r.found,
    sources: r.sources,
    confidence: r.confidence,
    retrieval: {
      mode: sem.semantic ? "hybrid" : "lexical",
      ...(sem.semantic
        ? { semanticModel: sem.semantic.provider, semanticCoverage: sem.semantic.coverage }
        : { semanticReason: sem.off }),
      considered: r.considered,
      excluded: r.excluded,
    },
    provider: status.provider.id,
  };
  const sources = r.sources.length
    ? `\nSources:\n${r.sources.map((s) => `- [${s.ref}] ${s.title} (${s.type}, ${s.trust}${s.verified ? `, verified ${s.verified}` : ""})`).join("\n")}\n`
    : "";
  return {
    data,
    text: `${r.answer}\n${sources}\nConfidence: ${r.confidence.note}\n`,
    warnings: [...sem.warnings, ...r.warnings],
  };
}
