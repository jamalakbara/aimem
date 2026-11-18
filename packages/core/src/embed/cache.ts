import { createHash } from "node:crypto";
import { join } from "node:path";
import type { NotebookIndex } from "../index/build.js";
import type { Fs, Random } from "../ports.js";
import type { Notebook } from "../project/load.js";
import { writeFileAtomic } from "../records/store.js";
import { tokenize } from "../search/bm25.js";
import { HIDDEN_STATUSES } from "../search/search.js";
import { scanSecrets } from "../secrets/scan.js";
import { CHUNKER_VERSION, type Chunk, chunkRecord } from "./chunk.js";
import type { EmbeddingProvider } from "./provider.js";

/** Vectors live outside git (15 §5): `.aimem/.cache/vectors/`. */
export const VECTOR_DIR = ".cache/vectors";
const BATCH = 64;
const HEAD_BONUS = 1.05;

export interface VectorCacheMeta {
  version: 1 | 2;
  provider: string;
  dimensions: number;
  chunkerVersion: number;
  chunks: { key: string; ref: string; section: string; part: number; bodySha: string; term?: string }[];
  /** Records deliberately not embedded (no-embed, possible secret); absent in older caches. */
  excluded?: string[];
}

export interface VectorCache {
  meta: VectorCacheMeta;
  /** chunks.length × dimensions, L2-normalised rows. */
  vectors: Float32Array;
}

export interface BuildResult {
  provider: string;
  chunks: number;
  built: number;
  reused: number;
  removed: number;
  /** True when no previous vectors could be reused. */
  rebuilt: boolean;
  reason?: string;
  excluded: { ref: string; reason: string }[];
}

const paths = (nb: Notebook) => ({
  meta: join(nb.dir, VECTOR_DIR, "meta.json"),
  vectors: join(nb.dir, VECTOR_DIR, "vectors.f32"),
});
const keyOf = (c: Chunk, providerId: string) =>
  createHash("sha256")
    .update(`${c.ref}\0${c.section}\0${c.part}\0${c.bodySha}\0${providerId}\0${c.term ?? ""}`)
    .digest("hex")
    .slice(0, 24);

/** Load the cache; a missing or damaged cache is reported, never thrown. */
export async function loadVectorCache(
  fs: Fs,
  nb: Notebook,
): Promise<{ cache?: VectorCache; problem?: string }> {
  const p = paths(nb);
  let meta: VectorCacheMeta;
  try {
    meta = JSON.parse(await fs.readFile(p.meta)) as VectorCacheMeta;
  } catch {
    return { problem: "no vector cache yet" };
  }
  if (
    (meta.version !== 1 && meta.version !== 2) ||
    !Array.isArray(meta.chunks) ||
    !Number.isInteger(meta.dimensions)
  )
    return { problem: "vector cache metadata is corrupt" };
  let bytes: Uint8Array;
  try {
    bytes = await fs.readBytes(p.vectors);
  } catch {
    return { problem: "vector file missing" };
  }
  if (bytes.byteLength !== meta.chunks.length * meta.dimensions * 4)
    return { problem: "vector file is corrupt (unexpected size)" };
  const vectors = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return { cache: { meta, vectors } };
}

/** Cheap check (reads meta.json only): the provider id the cache was built with, if any. */
export async function vectorCacheProvider(fs: Fs, nb: Notebook): Promise<string | undefined> {
  try {
    const meta = JSON.parse(await fs.readFile(paths(nb).meta)) as Partial<VectorCacheMeta>;
    return typeof meta.provider === "string" ? meta.provider : undefined;
  } catch {
    return undefined;
  }
}

function normalise(v: number[]): number[] {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

/**
 * Build or update the vector cache (15 §4.3): only changed chunks are embedded; a different
 * provider, dimension count or chunker version rebuilds everything. `no-embed` and
 * secret-flagged records are excluded (15 §12).
 */
export async function buildVectorCache(
  nb: Notebook,
  index: NotebookIndex,
  provider: EmbeddingProvider,
  deps: { fs: Fs; random: Random },
  options: { rebuild?: boolean } = {},
): Promise<BuildResult> {
  return (await updateVectorCache(nb, index, provider, deps, options)) as BuildResult;
}

/**
 * Refresh the vector cache after a record write (15 §13): embeds only new or changed chunks.
 * Runs only when a cache built with this provider already exists — a write never starts a cold
 * build (that stays with `aimem index --embeddings`). Never throws: the record is already
 * written, so a failure is returned as a warning and the next write or index run catches up.
 */
export async function refreshVectorsAfterWrite(
  nb: Notebook,
  index: NotebookIndex,
  provider: EmbeddingProvider,
  deps: { fs: Fs; random: Random },
): Promise<{ result?: BuildResult; warning?: string }> {
  try {
    const result = await updateVectorCache(nb, index, provider, deps, { onlyIfCached: true });
    return result ? { result } : {};
  } catch (e) {
    const msg = (e as Error).message.split("\n")[0] ?? "unknown error";
    return { warning: `embeddings not updated: ${msg}; run aimem index --embeddings` };
  }
}

async function updateVectorCache(
  nb: Notebook,
  index: NotebookIndex,
  provider: EmbeddingProvider,
  deps: { fs: Fs; random: Random },
  options: { rebuild?: boolean; onlyIfCached?: boolean },
): Promise<BuildResult | undefined> {
  let reason: string | undefined;
  let old: VectorCache | undefined;
  if (options.rebuild) reason = "rebuild requested";
  else {
    const loaded = await loadVectorCache(deps.fs, nb);
    if (!loaded.cache) reason = loaded.problem;
    else if (loaded.cache.meta.dimensions !== provider.dimensions)
      reason = `dimensions changed (${loaded.cache.meta.dimensions} → ${provider.dimensions})`;
    else if (loaded.cache.meta.provider !== provider.id)
      reason = `model changed (${loaded.cache.meta.provider} → ${provider.id})`;
    else if (loaded.cache.meta.chunkerVersion !== CHUNKER_VERSION) reason = "chunker changed";
    else old = loaded.cache;
  }
  if (!old && options.onlyIfCached) return undefined;

  const excluded: BuildResult["excluded"] = [];
  const chunks: Chunk[] = [];
  for (const r of index.records) {
    if (r.tags.includes("no-embed")) excluded.push({ ref: r.id, reason: "tagged no-embed" });
    else if (scanSecrets(r.text).length) excluded.push({ ref: r.id, reason: "possible secret" });
    else chunks.push(...chunkRecord(r));
  }
  // A bounded vocabulary lets the local encoder bridge a query to a precise corpus word.
  // Each word is embedded once; ownership keeps exclusions and incremental invalidation explicit.
  if (provider.id.startsWith("local:")) {
    const excludedRefs = new Set(excluded.map((r) => r.ref));
    const bodyHashes = new Map(chunks.map((c) => [c.ref, c.bodySha]));
    const vocabulary = new Map<string, { ref: string; bodySha: string; frequency: number }>();
    for (const r of [...index.records].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (excludedRefs.has(r.id) || HIDDEN_STATUSES.has(r.status)) continue;
      const bodySha = bodyHashes.get(r.id);
      if (!bodySha) continue;
      for (const term of new Set(tokenize(`${r.title} ${r.summary} ${r.body}`))) {
        if (!/^\p{L}{3,32}$/u.test(term)) continue;
        const prior = vocabulary.get(term);
        if (prior) prior.frequency++;
        else vocabulary.set(term, { ref: r.id, bodySha, frequency: 1 });
      }
    }
    const selected = [...vocabulary.entries()]
      .sort(([a, x], [b, y]) => y.frequency - x.frequency || (a < b ? -1 : 1))
      .slice(0, 4096)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    for (const [term, source] of selected)
      chunks.push({
        ref: source.ref,
        bodySha: source.bodySha,
        section: "lexicon",
        part: 0,
        text: term,
        term,
      });
  }
  const previous = new Map<string, Float32Array>();
  const previousTerms = new Map<string, Float32Array>();
  if (old) {
    old.meta.chunks.forEach((c, i) => {
      const vector = old.vectors.subarray(i * old.meta.dimensions, (i + 1) * old.meta.dimensions);
      previous.set(c.key, vector);
      if (typeof c.term === "string") previousTerms.set(c.term, vector);
    });
  }

  const d = provider.dimensions;
  const keys = chunks.map((c) => keyOf(c, provider.id));
  const vectors = new Float32Array(chunks.length * d);
  const todo: number[] = [];
  keys.forEach((k, i) => {
    const term = chunks[i]?.term;
    const v = term ? previousTerms.get(term) : previous.get(k);
    if (v) vectors.set(v, i * d);
    else todo.push(i);
  });
  for (let b = 0; b < todo.length; ) {
    const batch = [todo[b++] as number];
    // Quantized short-word vectors depend on batch composition. Isolate vocabulary
    // inputs so adding/removing unrelated words cannot change a reusable vector.
    if (!chunks[batch[0] as number]?.term)
      while (b < todo.length && batch.length < BATCH && !chunks[todo[b] as number]?.term)
        batch.push(todo[b++] as number);
    const out = await provider.embed(
      batch.map((i) => chunks[i]?.text ?? ""),
      "document",
      { refCount: new Set(batch.map((i) => chunks[i]?.ref)).size },
    );
    batch.forEach((i, j) => {
      const v = out[j];
      if (!v || v.length !== d)
        throw new Error(`embedding provider returned ${v?.length ?? 0} dimensions, expected ${d}`);
      vectors.set(normalise(v), i * d);
    });
  }
  const keySet = new Set(keys);
  const removed = old ? old.meta.chunks.filter((c) => !keySet.has(c.key)).length : 0;
  const meta: VectorCacheMeta = {
    version: chunks.some((c) => c.term !== undefined) ? 2 : 1,
    provider: provider.id,
    dimensions: d,
    chunkerVersion: CHUNKER_VERSION,
    chunks: chunks.map((c, i) => ({
      key: keys[i] as string,
      ref: c.ref,
      section: c.section,
      part: c.part,
      bodySha: c.bodySha,
      ...(c.term ? { term: c.term } : {}),
    })),
    excluded: excluded.map((e) => e.ref),
  };
  const p = paths(nb);
  await writeFileAtomic(deps.fs, p.vectors, new Uint8Array(vectors.buffer), deps.random);
  await writeFileAtomic(deps.fs, p.meta, `${JSON.stringify(meta)}\n`, deps.random);
  return {
    provider: provider.id,
    chunks: chunks.length,
    built: todo.length,
    reused: chunks.length - todo.length,
    removed,
    rebuilt: !old,
    ...(reason ? { reason } : {}),
    excluded,
  };
}

/** Semantic score per record: best chunk cosine (head chunks get a small bonus), clamped to 0..1. */
export async function semanticScores(
  cache: VectorCache,
  provider: EmbeddingProvider,
  query: string,
): Promise<Map<string, number>> {
  return (await semanticMatches(cache, provider, query)).scores;
}

/** Record similarities and, for a confident local match, one corpus-derived lexical bridge. */
export async function semanticMatches(
  cache: VectorCache,
  provider: EmbeddingProvider,
  query: string,
  eligibleSources?: ReadonlySet<string>,
): Promise<{ scores: Map<string, number>; expansionTerm?: string }> {
  if (cache.meta.provider !== provider.id || cache.meta.dimensions !== provider.dimensions) {
    throw new Error(
      `vector cache was built with a different provider (${cache.meta.provider}); run aimem index --embeddings`,
    );
  }
  const [q] = await provider.embed([query], "query");
  const qv = normalise(q ?? []);
  const d = cache.meta.dimensions;
  const scores = new Map<string, number>();
  const terms: { term: string; score: number; row: number }[] = [];
  cache.meta.chunks.forEach((c, i) => {
    let dot = 0;
    for (let k = 0; k < d; k++) dot += (qv[k] ?? 0) * (cache.vectors[i * d + k] ?? 0);
    if (c.term !== undefined) {
      if (
        provider.id.startsWith("local:") &&
        typeof c.term === "string" &&
        /^\p{L}{3,32}$/u.test(c.term) &&
        (!eligibleSources || eligibleSources.has(c.ref)) &&
        Number.isFinite(dot)
      )
        terms.push({ term: c.term, score: dot, row: i });
      return;
    }
    const s = Math.min(1, Math.max(0, c.section === "head" ? dot * HEAD_BONUS : dot));
    if (s > (scores.get(c.ref) ?? 0)) scores.set(c.ref, s);
  });
  terms.sort((a, b) => b.score - a.score || (a.term < b.term ? -1 : 1));
  const best = terms[0];
  // Attested singular/plural forms are one concept, not competing meanings.
  // Require strong embedding agreement rather than stemming arbitrary query words.
  const variant =
    best &&
    terms.find((t) => {
      if (t.term !== `${best.term}s` && best.term !== `${t.term}s`) return false;
      let similarity = 0;
      for (let k = 0; k < d; k++)
        similarity += (cache.vectors[best.row * d + k] ?? 0) * (cache.vectors[t.row * d + k] ?? 0);
      return similarity >= 0.8;
    });
  const second = terms.find((t) => t !== best && t !== variant);
  const expansionTerm =
    best &&
    second &&
    best.score >= 0.4 &&
    best.score - second.score >= 0.01 &&
    !tokenize(query).includes(best.term)
      ? [best.term, ...(variant ? [variant.term] : [])].join(" ")
      : undefined;
  return { scores, ...(expansionTerm ? { expansionTerm } : {}) };
}
