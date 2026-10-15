import { createHash } from "node:crypto";
import { join } from "node:path";
import type { NotebookIndex } from "../index/build.js";
import type { Fs, Random } from "../ports.js";
import type { Notebook } from "../project/load.js";
import { writeFileAtomic } from "../records/store.js";
import { scanSecrets } from "../secrets/scan.js";
import { CHUNKER_VERSION, type Chunk, chunkRecord } from "./chunk.js";
import type { EmbeddingProvider } from "./provider.js";

/** Vectors live outside git (15 §5): `.aimem/.cache/vectors/`. */
export const VECTOR_DIR = ".cache/vectors";
const BATCH = 64;
const HEAD_BONUS = 1.05;

export interface VectorCacheMeta {
  version: 1;
  provider: string;
  dimensions: number;
  chunkerVersion: number;
  chunks: { key: string; ref: string; section: string; part: number; bodySha: string }[];
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
    .update(`${c.ref}\0${c.section}\0${c.part}\0${c.bodySha}\0${providerId}`)
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
  if (meta.version !== 1 || !Array.isArray(meta.chunks) || !Number.isInteger(meta.dimensions))
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
  const excluded: BuildResult["excluded"] = [];
  const chunks: Chunk[] = [];
  for (const r of index.records) {
    if (r.tags.includes("no-embed")) excluded.push({ ref: r.id, reason: "tagged no-embed" });
    else if (scanSecrets(r.text).length) excluded.push({ ref: r.id, reason: "possible secret" });
    else chunks.push(...chunkRecord(r));
  }

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
  const previous = new Map<string, Float32Array>();
  if (old) {
    old.meta.chunks.forEach((c, i) => {
      previous.set(c.key, old.vectors.subarray(i * old.meta.dimensions, (i + 1) * old.meta.dimensions));
    });
  }

  const d = provider.dimensions;
  const keys = chunks.map((c) => keyOf(c, provider.id));
  const vectors = new Float32Array(chunks.length * d);
  const todo: number[] = [];
  keys.forEach((k, i) => {
    const v = previous.get(k);
    if (v) vectors.set(v, i * d);
    else todo.push(i);
  });
  for (let b = 0; b < todo.length; b += BATCH) {
    const batch = todo.slice(b, b + BATCH);
    const out = await provider.embed(
      batch.map((i) => chunks[i]?.text ?? ""),
      "document",
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
    version: 1,
    provider: provider.id,
    dimensions: d,
    chunkerVersion: CHUNKER_VERSION,
    chunks: chunks.map((c, i) => ({
      key: keys[i] as string,
      ref: c.ref,
      section: c.section,
      part: c.part,
      bodySha: c.bodySha,
    })),
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
  if (cache.meta.provider !== provider.id || cache.meta.dimensions !== provider.dimensions) {
    throw new Error(
      `vector cache was built with a different provider (${cache.meta.provider}); run aimem index --embeddings`,
    );
  }
  const [q] = await provider.embed([query], "query");
  const qv = normalise(q ?? []);
  const d = cache.meta.dimensions;
  const scores = new Map<string, number>();
  cache.meta.chunks.forEach((c, i) => {
    let dot = 0;
    for (let k = 0; k < d; k++) dot += (qv[k] ?? 0) * (cache.vectors[i * d + k] ?? 0);
    const s = Math.min(1, Math.max(0, c.section === "head" ? dot * HEAD_BONUS : dot));
    if (s > (scores.get(c.ref) ?? 0)) scores.set(c.ref, s);
  });
  return scores;
}
