import { dirname, join } from "node:path";
import type { EmbeddingProvider } from "../embed/provider.js";
import type { LlmProvider } from "../llm/provider.js";
import type { Clock, Fs } from "../ports.js";

export const CALL_LOG_PATH = ".cache/calls.jsonl";
export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/** Only known numeric counters cross the logging boundary. */
export function tokenUsage(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: TokenUsage = {};
  for (const key of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheCreationTokens"] as const) {
    const n = (value as Record<string, unknown>)[key];
    if (typeof n === "number" && Number.isSafeInteger(n) && n >= 0) out[key] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

export interface CallMetadata {
  kind: "llm" | "embedding.document" | "embedding.query";
  id: string;
  refCount?: number;
  inputCount?: number;
}
export interface CallLog {
  run<T>(
    meta: CallMetadata,
    call: () => Promise<T>,
    usage?: (result: T) => TokenUsage | undefined,
  ): Promise<T>;
}

/** Local diagnostics only: no prompt, answer, ref identifiers or error messages. */
export function createCallLog(nb: { dir: string }, deps: { fs: Fs; clock: Clock }): CallLog {
  const path = join(nb.dir, CALL_LOG_PATH);
  return {
    async run(meta, call, getUsage) {
      const start = deps.clock.now();
      let status = "error";
      let usage: TokenUsage | undefined;
      try {
        const result = await call();
        status = "ok";
        usage = tokenUsage(getUsage?.(result));
        return result;
      } finally {
        try {
          const split = meta.id.indexOf(":");
          const entry = {
            version: 1,
            time: start.toISOString(),
            kind: meta.kind,
            provider: split < 0 ? meta.id : meta.id.slice(0, split),
            model: split < 0 ? null : meta.id.slice(split + 1).split("@")[0],
            latencyMs: Math.max(0, deps.clock.now().getTime() - start.getTime()),
            status,
            refCount: meta.refCount ?? null,
            ...(meta.inputCount === undefined ? {} : { inputCount: meta.inputCount }),
            ...(usage ? { usage } : {}),
          };
          if (deps.fs.appendFile) {
            await deps.fs.mkdir(dirname(path));
            await deps.fs.appendFile(path, `${JSON.stringify(entry)}\n`);
          }
        } catch {
          /* Diagnostic failures must not change the operation's result. */
        }
      }
    },
  };
}

export function loggedLlmProvider(provider: LlmProvider, log: CallLog): LlmProvider {
  return {
    id: provider.id,
    generate: (req) =>
      log.run(
        { kind: "llm", id: provider.id, ...(req.refCount === undefined ? {} : { refCount: req.refCount }) },
        () => provider.generate(req),
        (r) => r.usage,
      ),
  };
}

export function loggedEmbeddingProvider(provider: EmbeddingProvider, log: CallLog): EmbeddingProvider {
  return {
    id: provider.id,
    dimensions: provider.dimensions,
    maxInputTokens: provider.maxInputTokens,
    embed: (texts, kind, meta) =>
      log.run(
        {
          kind: `embedding.${kind}`,
          id: provider.id,
          inputCount: texts.length,
          ...(kind === "query" ? { refCount: 0 } : meta),
        },
        () => provider.embed(texts, kind, meta),
        (r) => r.usage,
      ),
  };
}
