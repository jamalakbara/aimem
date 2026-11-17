import { join } from "node:path";
import {
  createLocalRanker,
  loadIndex,
  loadProject,
  nodeFs,
  rankLocalRecords,
  rerankContextCandidates,
  rerankSearchHits,
  scoreCandidates,
  search,
} from "@aimem/core";
import { expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";

it("normalizes narrow relevance bands before adding context metadata boosts", async () => {
  const nb = await loadProject(nodeFs, join(FIXTURES, "medium"));
  const index = await loadIndex(nb, { fs: nodeFs });
  const { candidates } = scoreCandidates(nb, index, { task: "records" }, new Date("2026-10-12T00:00:00Z"));
  const pair = candidates.filter((c) => c.record.trust === "verified").slice(0, 2);
  const relevant = pair[1];
  if (!relevant) throw new Error("missing candidates");
  const result = await rerankContextCandidates(pair, "records", {
    id: "fake",
    score: async () => [0.000001, 0.000002],
  });
  expect(result.candidates[0]?.record.id).toBe(relevant.record.id);
});

it("reranks candidates with trust and freshness, and preserves exact order on failure", async () => {
  const nb = await loadProject(nodeFs, join(FIXTURES, "medium"));
  const index = await loadIndex(nb, { fs: nodeFs });
  const hits = search(index, "records", { limit: 60 });
  const now = new Date("2026-10-12T00:00:00Z");
  const failed = await rerankSearchHits(nb, hits, "records", now);
  expect(failed.hits).toBe(hits);
  const ranked = await rerankSearchHits(nb, hits, "records", now, {
    id: "fake",
    score: async (_q, docs) => docs.map(() => 0.5),
  });
  expect(ranked.hits.map((h) => h.record.id).sort()).toEqual(hits.map((h) => h.record.id).sort());
  expect(ranked.warning).toBeUndefined();
  expect(ranked.hits[0]?.record.trust).toBe("verified");
});

it("loads cached models only and batches paired query/document inference", async () => {
  const calls: { question: string; documents: string[] }[] = [];
  const ranker = await createLocalRanker({
    cacheDir: "cache",
    allowDownload: false,
    loader: {
      load: async (_model, setup) => {
        expect(setup.allowDownload).toBe(false);
        return async (question, documents) => {
          calls.push({ question, documents });
          return documents.map(() => 0);
        };
      },
    },
  });
  expect(await ranker.score("question", ["one", "two"])).toEqual([0.5, 0.5]);
  expect(calls).toEqual([{ question: "question", documents: ["one", "two"] }]);
});

it.each([{ logits: [NaN] }, { logits: [Infinity] }, { logits: [] }, { logits: [0, 1] }])(
  "rejects invalid logits %j",
  async ({ logits }) => {
    const ranker = await createLocalRanker({
      cacheDir: "cache",
      allowDownload: false,
      loader: { load: async () => async () => logits },
    });
    await expect(ranker.score("question", ["one"])).rejects.toThrow();
  },
);

it("excludes private records, preserves original fallback and sends at most 50 bounded texts", async () => {
  const nb = await loadProject(nodeFs, join(FIXTURES, "medium"));
  const { records } = await loadIndex(nb, { fs: nodeFs });
  const input = records.slice(0, 60);
  const first = input[0];
  if (!first) throw new Error("fixture has no records");
  const privateRecord = { ...first, tags: ["no-embed"] };
  const out = await rankLocalRecords([privateRecord, ...input.slice(1)], "question", {
    id: "fake",
    score: async (_q, texts) => {
      expect(texts.length).toBeLessThanOrEqual(50);
      expect(texts.every((t) => t.length <= 2400)).toBe(true);
      expect(texts.some((t) => t.includes(privateRecord.title))).toBe(false);
      return texts.map((_t, i) => 1 / (i + 1));
    },
  });
  expect(out.scores.has(privateRecord.id)).toBe(false);
  expect(out.warning).toBeUndefined();
  expect(
    (
      await rankLocalRecords(input, "question", {
        id: "fake",
        score: async () => {
          throw new Error("sensitive details");
        },
      })
    ).scores.size,
  ).toBe(0);
  expect((await rankLocalRecords(input, "question")).warning).toBeDefined();
});

it("does not call inference for empty candidates or oversized questions", async () => {
  const ranker = {
    id: "fake",
    score: async () => {
      throw new Error("must not call");
    },
  };
  expect(await rankLocalRecords([], "question", ranker)).toEqual({ scores: new Map() });
  const nb = await loadProject(nodeFs, join(FIXTURES, "tiny"));
  const index = await loadIndex(nb, { fs: nodeFs });
  expect((await rankLocalRecords(index.records, "q".repeat(4097), ranker)).warning).toBeDefined();
});
