import type { EmbeddingProvider } from "./provider.js";

/** Candidate local multilingual models (15 §4.2, OQ-16), quantised ONNX via transformers.js. */
export const LOCAL_MODELS = {
  "multilingual-e5-small": {
    hub: "Xenova/multilingual-e5-small",
    dimensions: 384,
    pooling: "mean",
    queryPrefix: "query: ",
    documentPrefix: "passage: ",
    downloadMB: 118,
  },
  "paraphrase-multilingual-minilm": {
    hub: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    dimensions: 384,
    pooling: "mean",
    queryPrefix: "",
    documentPrefix: "",
    downloadMB: 118,
  },
  "bge-m3": {
    hub: "Xenova/bge-m3",
    dimensions: 1024,
    pooling: "cls",
    queryPrefix: "",
    documentPrefix: "",
    downloadMB: 570,
  },
} as const;

export type LocalModelName = keyof typeof LOCAL_MODELS;

/** Chosen by the model comparison on the eval set (OQ-16; docs/15 §4.2). */
export const DEFAULT_LOCAL_MODEL: LocalModelName = "paraphrase-multilingual-minilm";

type Extract = (texts: string[], options: { pooling: string; normalize: boolean }) => Promise<number[][]>;

/** Loads a feature-extraction model; injected in tests so they never download anything. */
export interface ModelLoader {
  load(hub: string, setup: { cacheDir: string; allowRemote: boolean }): Promise<Extract>;
}

const transformersLoader: ModelLoader = {
  async load(hub, setup) {
    let mod: typeof import("@huggingface/transformers");
    try {
      mod = await import("@huggingface/transformers");
    } catch {
      throw new Error("the local embedding runtime (@huggingface/transformers) is not installed");
    }
    mod.env.cacheDir = setup.cacheDir;
    mod.env.allowRemoteModels = setup.allowRemote;
    const pipe = await mod.pipeline("feature-extraction", hub, { dtype: "q8" });
    return async (texts, options) => {
      const out = await pipe(texts, options as Parameters<typeof pipe>[1]);
      return out.tolist() as number[][];
    };
  },
};

export interface LocalProviderOptions {
  /** A key of LOCAL_MODELS, or `auto` for the default. */
  model: string;
  /** Where models are cached (default `~/.cache/aimem/models`). */
  cacheDir: string;
  /** Only `aimem index --embeddings` may download (human decision, slice 2.4). */
  allowDownload: boolean;
  loader?: ModelLoader;
}

const BATCH = 16;

/** In-process multilingual embeddings; content never leaves the machine (15 §4.2). */
export async function createLocalProvider(opts: LocalProviderOptions): Promise<EmbeddingProvider> {
  const name = (opts.model === "auto" ? DEFAULT_LOCAL_MODEL : opts.model) as LocalModelName;
  const spec = LOCAL_MODELS[name];
  if (!spec)
    throw new Error(`unknown local model '${opts.model}' (known: ${Object.keys(LOCAL_MODELS).join(", ")})`);
  let extract: Extract;
  try {
    extract = await (opts.loader ?? transformersLoader).load(spec.hub, {
      cacheDir: opts.cacheDir,
      allowRemote: opts.allowDownload,
    });
  } catch (e) {
    const msg = (e as Error).message.split("\n")[0] ?? "unknown error";
    if (msg.includes("runtime")) throw e;
    throw new Error(
      opts.allowDownload
        ? `could not download or load local model ${name}: ${msg}`
        : `local model ${name} is not downloaded yet; run aimem index --embeddings (downloads ~${spec.downloadMB} MB)`,
    );
  }
  return {
    id: `local:${name}`,
    dimensions: spec.dimensions,
    maxInputTokens: 512,
    async embed(texts, kind) {
      const prefix = kind === "query" ? spec.queryPrefix : spec.documentPrefix;
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH) {
        out.push(
          ...(await extract(
            texts.slice(i, i + BATCH).map((t) => `${prefix}${t}`),
            { pooling: spec.pooling, normalize: true },
          )),
        );
      }
      return out;
    },
  };
}
