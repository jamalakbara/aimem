import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildBriefing,
  buildIndex,
  buildVectorCache,
  hashEmbedder,
  loadProject,
  loadVectorCache,
  nodeFs,
  scoreCandidates,
  semanticForQuery,
  semanticScores,
} from "@aimem/core";
import { afterEach, expect, it } from "vitest";
import { FIXTURES, fixedRandom } from "./helpers.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
async function setup() {
  const root = mkdtempSync(join(tmpdir(), "aimem-bridge-"));
  roots.push(root);
  cpSync(join(FIXTURES, "tiny"), root, { recursive: true });
  return loadProject(nodeFs, root);
}
function records() {
  return buildIndex(
    [
      { id: "mem-00000001", word: "offline", status: "active", tags: "[]" },
      { id: "mem-00000002", word: "network", status: "active", tags: "[]" },
      { id: "mem-00000003", word: "excludedword", status: "active", tags: "[no-embed]" },
      { id: "mem-00000004", word: "obsoleteword", status: "superseded", tags: "[]" },
    ].map((r) => ({
      file: `.aimem/memory/${r.id}-example.md`,
      dirType: "memory" as const,
      text: `---\naimem: 1\nid: ${r.id}\ntype: memory\ntitle: ${r.word}\nsummary: ${r.word}\nstatus: ${r.status}\ntrust: verified\nroles: [all]\ntags: ${r.tags}\nauthor: agent:test\ncreated: 2026-10-01T00:00:00Z\nupdated: 2026-10-01T00:00:00Z\n---\n${r.word}`,
    })),
  );
}
it("builds a deduplicated local vocabulary, excludes hidden/private sources and reuses it", async () => {
  const nb = await setup(),
    index = records(),
    provider = { ...hashEmbedder(8), id: "local:test" };
  const first = await buildVectorCache(nb, index, provider, { fs: nodeFs, random: fixedRandom(1) });
  const { cache } = await loadVectorCache(nodeFs, nb);
  const terms = cache?.meta.chunks.flatMap((c) => ("term" in c ? [c.term] : []));
  expect(terms).toEqual(["network", "offline"]);
  expect(await buildVectorCache(nb, index, provider, { fs: nodeFs, random: fixedRandom(2) })).toMatchObject({
    built: 0,
    reused: first.chunks,
  });
});
it("bridges a confident corpus term using one query embedding and retains original dense scores", async () => {
  const nb = await setup(),
    index = records();
  let queries = 0;
  const provider = {
    id: "local:test",
    dimensions: 2,
    maxInputTokens: 512,
    embed: async (texts: string[], kind: "document" | "query") => {
      if (kind === "query") queries++;
      return texts.map((text) =>
        text === "offline" ? [1, 0] : text === "network" ? [0, 1] : kind === "query" ? [1, 0] : [0.6, 0.8],
      );
    },
  };
  await buildVectorCache(nb, index, provider, { fs: nodeFs, random: fixedRandom(1) });
  const result = await semanticForQuery(nb, index, provider, "disconnected laptop", { fs: nodeFs });
  expect(result).toMatchObject({ expansionTerm: "offline" });
  expect(queries).toBe(1);
  if (!("scores" in result)) throw new Error("expected semantic scores");
  expect(result.scores.get("mem-00000001")).toBeCloseTo(0.63, 5);
  const literal = await semanticForQuery(nb, index, provider, "offline", { fs: nodeFs });
  expect(literal).not.toHaveProperty("expansionTerm");
});
it("fuses complete context scores without weakening trust/freshness or resurrecting hidden records", async () => {
  const nb = await setup(),
    index = records(),
    now = new Date("2026-10-12T00:00:00Z");
  const semantic = {
    scores: new Map([
      ["mem-00000001", 0.4],
      ["mem-00000002", 0.9],
    ]),
    provider: "local:test",
    coverage: 1,
    expansionTerm: "offline",
  };
  const baseline = scoreCandidates(
    nb,
    index,
    { task: "unrelated", semantic: { ...semantic, expansionTerm: undefined } },
    now,
  );
  const result = scoreCandidates(nb, index, { task: "unrelated", semantic }, now);
  const matching = result.candidates.find((c) => c.record.id === "mem-00000001");
  expect(matching?.parts.lexical).toBe(1);
  expect(result.candidates.some((c) => c.record.id === "mem-00000004")).toBe(false);
  for (const before of baseline.candidates) {
    const after = result.candidates.find((c) => c.record.id === before.record.id);
    expect(after?.parts.trust).toBe(before.parts.trust);
    expect(after?.parts.freshness).toBe(before.parts.freshness);
    expect(after?.parts.total).toBeGreaterThanOrEqual(before.parts.total);
  }
  const b = buildBriefing(nb, index, { task: "unrelated", semantic }, now);
  expect(b.header.used).toBeLessThanOrEqual(b.header.budget);
});
it("legacy caches and nonlocal providers keep their original retrieval", async () => {
  const nb = await setup(),
    index = records(),
    provider = hashEmbedder(8);
  await buildVectorCache(nb, index, provider, { fs: nodeFs, random: fixedRandom(1) });
  const { cache } = await loadVectorCache(nodeFs, nb);
  if (!cache) throw new Error("missing cache");
  expect(cache.meta.chunks.some((c) => "term" in c)).toBe(false);
  expect(await semanticForQuery(nb, index, provider, "unrelated", { fs: nodeFs })).not.toHaveProperty(
    "expansionTerm",
  );
  expect(await semanticScores(cache, provider, "unrelated")).toBeInstanceOf(Map);
});
it.each(["private", "hidden", "removed"])(
  "ignores a lexicon source that became %s since indexing",
  async (change) => {
    const nb = await setup(),
      index = records();
    const provider = {
      id: "local:test",
      dimensions: 2,
      maxInputTokens: 512,
      embed: async (texts: string[], kind: "document" | "query") =>
        texts.map((t) => (t === "offline" || kind === "query" ? [1, 0] : [0, 1])),
    };
    await buildVectorCache(nb, index, provider, { fs: nodeFs, random: fixedRandom(1) });
    const updated = {
      ...index,
      records: index.records.flatMap((r) =>
        r.id !== "mem-00000001"
          ? [r]
          : change === "removed"
            ? []
            : [{ ...r, ...(change === "private" ? { tags: ["no-embed"] } : { status: "superseded" }) }],
      ),
    };
    expect(
      await semanticForQuery(nb, updated, provider, "disconnected laptop", { fs: nodeFs }),
    ).not.toHaveProperty("expansionTerm");
  },
);
it.each(["weak", "ambiguous"])("does not expand a %s vocabulary match", async (mode) => {
  const nb = await setup(),
    index = records();
  const provider = {
    id: "local:test",
    dimensions: 2,
    maxInputTokens: 512,
    embed: async (texts: string[], kind: "document" | "query") =>
      texts.map((t) =>
        kind === "query"
          ? [1, 0]
          : mode === "weak"
            ? [0, 1]
            : t === "offline" || t === "network"
              ? [1, 0]
              : [0, 1],
      ),
  };
  await buildVectorCache(nb, index, provider, { fs: nodeFs, random: fixedRandom(1) });
  expect(
    await semanticForQuery(nb, index, provider, "disconnected laptop", { fs: nodeFs }),
  ).not.toHaveProperty("expansionTerm");
});
it("bounds the local vocabulary and keeps selection deterministic", async () => {
  const nb = await setup(),
    base = records();
  const words = Array.from(
    { length: 4200 },
    (_, i) =>
      `term${String.fromCharCode(97 + Math.floor(i / 676), 97 + (Math.floor(i / 26) % 26), 97 + (i % 26))}`,
  ).join(" ");
  const index = { ...base, records: base.records.map((r, i) => (i === 0 ? { ...r, body: words } : r)) };
  const provider = { ...hashEmbedder(2), id: "local:test" };
  await buildVectorCache(nb, index, provider, { fs: nodeFs, random: fixedRandom(1) });
  const a = (await loadVectorCache(nodeFs, nb)).cache?.meta.chunks.filter((c) => "term" in c);
  expect(a).toHaveLength(4096);
  await buildVectorCache(nb, index, provider, { fs: nodeFs, random: fixedRandom(2) }, { rebuild: true });
  expect((await loadVectorCache(nodeFs, nb)).cache?.meta.chunks.filter((c) => "term" in c)).toEqual(a);
});
it("rejects invalid expansion text", async () => {
  const nb = await setup(),
    index = records(),
    now = new Date("2026-10-12T00:00:00Z");
  const semantic = { scores: new Map([["mem-00000001", 0.5]]), provider: "local:test", coverage: 1 };
  const original = scoreCandidates(nb, index, { task: "network", semantic }, now);
  expect(
    scoreCandidates(
      nb,
      index,
      { task: "network", semantic: { ...semantic, expansionTerm: "offline additional text" } },
      now,
    ),
  ).toEqual(original);
});
it("keeps quantized vocabulary inputs independent of unrelated batch members", async () => {
  const nb = await setup(),
    index = records(),
    base = hashEmbedder(4);
  const provider = {
    ...base,
    id: "local:test",
    embed: async (texts: string[], kind: "document" | "query") => {
      if (texts.some((t) => t === "offline" || t === "network")) expect(texts).toHaveLength(1);
      return base.embed(texts, kind);
    },
  };
  await buildVectorCache(nb, index, provider, { fs: nodeFs, random: fixedRandom(1) });
  expect((await loadVectorCache(nodeFs, nb)).cache?.meta.version).toBe(2);
});
it("excludes secret-flagged vocabulary sources", async () => {
  const nb = await setup(),
    original = records();
  const index = {
    ...original,
    records: original.records.map((r) =>
      r.id === "mem-00000001" ? { ...r, text: `${r.text}\n-----BEGIN PRIVATE KEY-----` } : r,
    ),
  };
  await buildVectorCache(
    nb,
    index,
    { ...hashEmbedder(4), id: "local:test" },
    { fs: nodeFs, random: fixedRandom(1) },
  );
  expect((await loadVectorCache(nodeFs, nb)).cache?.meta.chunks.some((c) => c.ref === "mem-00000001")).toBe(
    false,
  );
});
it("keeps expired agent evidence below fresh verified evidence after bridging", async () => {
  const nb = await setup(),
    original = records(),
    now = new Date("2026-10-12T00:00:00Z");
  const index = {
    ...original,
    records: original.records.map((r) =>
      r.id === "mem-00000001"
        ? { ...r, trust: "agent", fm: { ...r.fm, trust: "agent", expires: "2020-01-01" } }
        : r,
    ),
  };
  const semantic = {
    provider: "local:test",
    coverage: 1,
    scores: new Map([
      ["mem-00000001", 0.9],
      ["mem-00000002", 0.5],
    ]),
    expansionTerm: "offline",
  };
  const result = scoreCandidates(nb, index, { task: "network", semantic }, now);
  const expired = result.candidates.find((c) => c.record.id === "mem-00000001");
  expect(expired?.parts).toMatchObject({ trust: 0.7, freshness: 0.3 });
  expect(result.candidates[0]?.record.id).toBe("mem-00000002");
});
it("uses attested, embedding-aligned word forms as one concept", async () => {
  const nb = await setup(),
    original = records();
  const index = {
    ...original,
    records: original.records.map((r, i) =>
      i === 0 ? { ...r, title: "keys key", summary: "keys key", body: "keys key" } : r,
    ),
  };
  const provider = {
    id: "local:test",
    dimensions: 2,
    maxInputTokens: 512,
    embed: async (texts: string[], kind: "document" | "query") =>
      texts.map((t) => (kind === "query" || t === "keys" ? [1, 0] : t === "key" ? [0.999, 0.0447] : [0, 1])),
  };
  await buildVectorCache(nb, index, provider, { fs: nodeFs, random: fixedRandom(1) });
  expect(await semanticForQuery(nb, index, provider, "credentials", { fs: nodeFs })).toMatchObject({
    expansionTerm: "keys key",
  });
});
it("reuses word vectors when their source record changes", async () => {
  const nb = await setup(),
    index = records(),
    base = hashEmbedder(4),
    wordCalls: string[] = [];
  const provider = {
    ...base,
    id: "local:test",
    embed: async (texts: string[], kind: "document" | "query") => {
      if (kind === "document")
        wordCalls.push(...texts.filter((t) => ["offline", "network", "additional"].includes(t)));
      return base.embed(texts, kind);
    },
  };
  await buildVectorCache(nb, index, provider, { fs: nodeFs, random: fixedRandom(1) });
  wordCalls.length = 0;
  const changed = {
    ...index,
    records: index.records.map((r, i) => (i === 0 ? { ...r, body: `${r.body} additional` } : r)),
  };
  const result = await buildVectorCache(nb, changed, provider, { fs: nodeFs, random: fixedRandom(2) });
  expect(wordCalls).toEqual(["additional"]);
  expect(result.built).toBe(3);
});
