import type { ProcessRunner } from "../process/run.js";
import type { ResolvedProject } from "../project/load.js";
import { createClaudeCliProvider } from "./claude-cli.js";

export interface LlmRequest {
  /** Rules for the model (e.g. the `ask` citation rules, 15 §10). */
  system: string;
  /** The user turn: question plus framed records. */
  prompt: string;
}

/** Generation provider used by `ask`, rerank and query rewrite (15 §11). */
export interface LlmProvider {
  /** e.g. `claude-cli` or `claude-cli:<model>`. */
  id: string;
  generate(req: LlmRequest): Promise<{ text: string }>;
}

export type LlmStatus = { available: true; provider: LlmProvider } | { available: false; reason: string };

const DEFAULT_TIMEOUT_SECONDS = 120;

/** Build the configured LLM provider, or say why there is none (15 §11–§12). Never throws. */
export function loadLlmProvider(
  config: Pick<ResolvedProject, "retrieval">,
  opts: { runner: ProcessRunner; env: Record<string, string | undefined> },
): LlmStatus {
  const llm = config.retrieval?.llm ?? {};
  const provider = llm.provider ?? "none";
  if (provider === "none") return { available: false, reason: "retrieval.llm.provider is none" };
  if (provider === "openai-compatible")
    return { available: false, reason: "the openai-compatible LLM provider is not implemented yet" };
  if (llm.allow_remote !== true)
    return {
      available: false,
      reason:
        "claude-cli sends record text to Anthropic through your Claude Code login; set retrieval.llm.allow_remote: true to allow it",
    };
  return {
    available: true,
    provider: createClaudeCliProvider({
      runner: opts.runner,
      command: opts.env.AIMEM_CLAUDE_BIN || "claude",
      timeoutMs: (llm.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000,
      ...(llm.model ? { model: llm.model } : {}),
    }),
  };
}
