import { join } from "node:path";
import {
  contextWithRewrites,
  loadIndex,
  loadProject,
  nodeFs,
  rewriteQueries,
  scoreCandidates,
  search,
  searchWithRewrites,
} from "@aimem/core";
import { expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";

const notebook = () => loadProject(nodeFs, join(FIXTURES, "tiny"));

it("keeps default search and context scoring byte-for-byte equivalent", async () => {
  const nb = await notebook();
  const index = await loadIndex(nb, { fs: nodeFs });
  const now = new Date("2026-10-12T00:00:00Z");
  expect((await searchWithRewrites(nb, index, "ledger", { limit: 3 }, {})).hits).toEqual(
    search(index, "ledger", { limit: 3 }),
  );
  expect((await contextWithRewrites(nb, index, { task: "ledger" }, now, {})).scored).toEqual(
    scoreCandidates(nb, index, { task: "ledger" }, now),
  );
});

it("searches original and reformulations, retaining hard filters and deterministic fusion", async () => {
  const nb = await notebook();
  nb.config.retrieval = { query_rewrite: "llm", llm: { allow_remote: true } };
  const index = await loadIndex(nb, { fs: nodeFs });
  const deps = {
    llm: { id: "fake", generate: async () => ({ text: '["postgres ledger", "transactions database"]' }) },
  };
  const opts = { types: ["decision"], limit: 3 };
  const first = await searchWithRewrites(nb, index, "unknown wording", opts, deps);
  expect(first.hits.length).toBeGreaterThan(0);
  expect(first.hits.every((h) => h.record.type === "decision" && h.record.status !== "superseded")).toBe(
    true,
  );
  expect(await searchWithRewrites(nb, index, "unknown wording", opts, deps)).toEqual(first);
});

it("never calls a model when disabled or consent is absent", async () => {
  const nb = await notebook();
  let calls = 0;
  const llm = {
    id: "fake",
    generate: async () => {
      calls++;
      return { text: '["retry delivery","duplicate requests"]' };
    },
  };
  expect(await rewriteQueries(nb, "retry", llm)).toEqual({ queries: ["retry"] });
  nb.config.retrieval = { query_rewrite: "llm", llm: { allow_remote: false } };
  expect((await rewriteQueries(nb, "retry", llm)).queries).toEqual(["retry"]);
  expect(calls).toBe(0);
});

it("retains the original query, bounds reformulations and sends no records", async () => {
  const nb = await notebook();
  nb.config.retrieval = { query_rewrite: "llm", llm: { allow_remote: true } };
  const out = await rewriteQueries(nb, "retry", {
    id: "fake",
    generate: async (req) => {
      expect(req.refCount).toBe(0);
      expect(req.prompt).toBe("retry");
      return { text: '["retry delivery", "duplicate requests"]' };
    },
  });
  expect(out).toEqual({ queries: ["retry", "retry delivery", "duplicate requests"] });
});

it.each([
  "no json",
  "[]",
  '["one"]',
  '["same","same"]',
  '["retry","other"]',
  '["a","b","c","d"]',
  JSON.stringify(["x".repeat(513), "other"]),
])("falls back exactly for invalid rewrites: %s", async (text) => {
  const nb = await notebook();
  nb.config.retrieval = { query_rewrite: "llm", llm: { allow_remote: true } };
  const out = await rewriteQueries(nb, "retry", { id: "fake", generate: async () => ({ text }) });
  expect(out.queries).toEqual(["retry"]);
  expect(out.warning).toBeDefined();
});

it("falls back on unavailable providers, failures and oversized queries", async () => {
  const nb = await notebook();
  nb.config.retrieval = { query_rewrite: "llm", llm: { allow_remote: true } };
  expect((await rewriteQueries(nb, "retry")).warning).toBeDefined();
  const llm = {
    id: "fake",
    generate: async () => {
      throw new Error("secret provider details");
    },
  };
  expect((await rewriteQueries(nb, "retry", llm)).warning).not.toContain("secret");
  expect((await rewriteQueries(nb, "x".repeat(4097), llm)).queries).toEqual(["x".repeat(4097)]);
});
