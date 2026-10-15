import type { EmbeddingProvider } from "./provider.js";

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface OpenAICompatibleOptions {
  endpoint: string;
  model: string;
  /** From AIMEM_EMBEDDINGS_KEY; never stored in project.yaml (15 §11). */
  apiKey?: string;
  /** retrieval.embeddings.allow_remote — note text is sent to `endpoint` (15 §12). */
  allowRemote: boolean;
  fetch: FetchLike;
}

const BATCH = 64;

/** Embeddings from any OpenAI-compatible `/embeddings` endpoint (Ollama, LM Studio, vLLM, hosted APIs). */
export async function createOpenAICompatibleProvider(
  opts: OpenAICompatibleOptions,
): Promise<EmbeddingProvider> {
  const base = opts.endpoint.replace(/\/+$/, "");
  if (!opts.allowRemote) {
    throw new Error(
      `allow_remote is false; set retrieval.embeddings.allow_remote: true to send note text to ${base}`,
    );
  }
  const host = new URL(base).host;
  const call = async (input: string[]): Promise<number[][]> => {
    const res = await opts.fetch(`${base}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: opts.model, input }),
    });
    if (!res.ok) throw new Error(`embedding endpoint ${host} answered HTTP ${res.status}`);
    const json = (await res.json()) as { data?: { index: number; embedding: number[] }[] };
    if (!Array.isArray(json.data) || json.data.length !== input.length)
      throw new Error(`embedding endpoint ${host} returned an unexpected response`);
    return [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
  };
  const [probe] = await call(["dimension probe"]);
  const dimensions = probe?.length ?? 0;
  if (!dimensions) throw new Error(`embedding endpoint ${host} returned empty vectors`);
  return {
    id: `openai-compatible:${opts.model}@${host}`,
    dimensions,
    maxInputTokens: 512,
    async embed(texts) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH) out.push(...(await call(texts.slice(i, i + BATCH))));
      return out;
    },
  };
}
