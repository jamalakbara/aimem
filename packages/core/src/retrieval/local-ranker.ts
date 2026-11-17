import { TRUST_WEIGHT, type Trust } from "@aimem/schema";
import type { Candidate } from "../context/score.js";
import type { IndexedRecord } from "../index/build.js";
import type { Notebook } from "../project/load.js";
import type { SearchHit } from "../search/search.js";
import { scanSecrets } from "../secrets/scan.js";
import { normaliseSemantic } from "../util/normalise.js";
import { freshnessOf } from "../validate/validate.js";

export const CROSS_ENCODER_MODELS = {
  minilm: { hub: "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1", file: "model_quint8_avx2", dtype: "fp32" },
  bge: { hub: "onnx-community/bge-reranker-v2-m3-ONNX", file: "model", dtype: "q8" },
} as const;
export const DEFAULT_RANKER_MODEL = "minilm";
export interface LocalRanker {
  id: string;
  /** One finite relevance score in [0,1] per document. Never sends content remotely. */
  score(question: string, documents: string[]): Promise<number[]>;
}
export interface RankerLoader {
  load(
    model: keyof typeof CROSS_ENCODER_MODELS,
    setup: { cacheDir: string; allowDownload: boolean },
  ): Promise<(question: string, documents: string[]) => Promise<number[]>>;
}
const loader: RankerLoader = {
  async load(name, setup) {
    const { AutoTokenizer, AutoModelForSequenceClassification } = await import("@huggingface/transformers");
    const spec = CROSS_ENCODER_MODELS[name];
    const options = { cache_dir: setup.cacheDir, local_files_only: !setup.allowDownload };
    // Load sequentially so a failed model load does not leave a tokenizer promise running.
    const tokenizer = await AutoTokenizer.from_pretrained(spec.hub, options);
    const model = await AutoModelForSequenceClassification.from_pretrained(spec.hub, {
      ...options,
      dtype: spec.dtype,
      model_file_name: spec.file,
    });
    return async (question, documents) => {
      const result: number[] = [];
      for (let i = 0; i < documents.length; i += 4) {
        const docs = documents.slice(i, i + 4);
        const inputs = tokenizer(
          docs.map(() => question),
          { text_pair: docs, padding: true, truncation: true, max_length: 512 },
        );
        const output = await model(inputs);
        const logits = output.logits as { dims: number[]; data: ArrayLike<number | bigint> };
        if (logits.dims.length !== 2 || logits.dims[0] !== docs.length || logits.dims[1] !== 1)
          throw new Error("ranker returned unexpected logits shape");
        result.push(...Array.from(logits.data, Number));
      }
      return result;
    };
  },
};

export async function createLocalRanker(opts: {
  cacheDir: string;
  allowDownload: boolean;
  model?: keyof typeof CROSS_ENCODER_MODELS;
  loader?: RankerLoader;
}): Promise<LocalRanker> {
  const name = opts.model ?? DEFAULT_RANKER_MODEL;
  const infer = await (opts.loader ?? loader).load(name, opts);
  return {
    id: `cross-encoder:${name}`,
    async score(question, documents) {
      const logits = await infer(question, documents);
      if (logits.length !== documents.length || logits.some((x) => !Number.isFinite(x)))
        throw new Error("ranker returned invalid logits");
      return logits.map((x) => 1 / (1 + Math.exp(-x)));
    },
  };
}

/** Local inference still respects no-embed and secret exclusions, before candidate truncation. */
export async function rankLocalRecords(
  records: IndexedRecord[],
  question: string,
  ranker?: LocalRanker,
): Promise<{ scores: Map<string, number>; warning?: string }> {
  const scores = new Map<string, number>();
  if (!records.length) return { scores };
  const fallback = (reason: string) => ({ scores, warning: `cross-encoder ${reason}; using original order` });
  if (!ranker) return fallback("model unavailable; run aimem index --reranker");
  if (question.length > 4096) return fallback("query limit exceeded");
  const candidates = records
    .filter((r) => !r.tags.includes("no-embed") && scanSecrets(r.text).length === 0)
    .slice(0, 50);
  if (!candidates.length) return { scores };
  try {
    const values = await ranker.score(
      question,
      candidates.map((r) => `${r.title}\n${r.summary}\n${r.body}`.slice(0, 2400)),
    );
    if (values.length !== candidates.length || values.some((x) => !Number.isFinite(x) || x < 0 || x > 1))
      return fallback("returned invalid scores");
    candidates.forEach((r, i) => {
      scores.set(r.id, values[i] as number);
    });
    return { scores };
  } catch {
    return fallback("inference failed");
  }
}

export async function rerankSearchHits(
  nb: Notebook,
  hits: SearchHit[],
  question: string,
  now: Date,
  ranker?: LocalRanker,
): Promise<{ hits: SearchHit[]; warning?: string }> {
  const result = await rankLocalRecords(
    hits.map((h) => h.record),
    question,
    ranker,
  );
  if (result.warning || !result.scores.size)
    return { hits, ...(result.warning ? { warning: result.warning } : {}) };
  const ranked = hits
    .filter((h) => result.scores.has(h.record.id))
    .map((h) => {
      const r = h.record;
      const freshness = { fresh: 1, stale: 0.6, expired: 0.3 }[
        freshnessOf({ ...r.fm, type: r.type, created: r.created }, nb.config, now)
      ];
      const raw = (result.scores.get(r.id) ?? 0) * (TRUST_WEIGHT[r.trust as Trust] ?? 0.4) * freshness;
      return { ...h, raw, score: raw };
    })
    .sort((a, b) => b.raw - a.raw || a.record.id.localeCompare(b.record.id));
  return { hits: [...ranked, ...hits.filter((h) => !result.scores.has(h.record.id))] };
}

export async function rerankContextCandidates(
  candidates: Candidate[],
  question: string,
  ranker?: LocalRanker,
): Promise<{ candidates: Candidate[]; warning?: string }> {
  const result = await rankLocalRecords(
    candidates.map((c) => c.record),
    question,
    ranker,
  );
  if (result.warning || !result.scores.size)
    return { candidates, ...(result.warning ? { warning: result.warning } : {}) };
  const normalized = normaliseSemantic(result.scores, [...result.scores.keys()]);
  const ranked = candidates
    .filter((c) => result.scores.has(c.record.id))
    .map((c) => {
      const p = c.parts;
      const relevance = normalized.get(c.record.id) ?? 0;
      const total =
        (0.5 * relevance +
          0.2 * p.paths +
          0.1 * p.links +
          0.1 * p.recency +
          0.05 * p.typeBoost +
          0.05 * p.roleMatch) *
        p.trust *
        p.freshness;
      return { ...c, parts: { ...p, total: Math.round(total * 10000) / 10000 } };
    })
    .sort((a, b) => b.parts.total - a.parts.total || a.record.id.localeCompare(b.record.id));
  return { candidates: [...ranked, ...candidates.filter((c) => !result.scores.has(c.record.id))] };
}
