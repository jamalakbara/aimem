import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { type Harness, harness } from "./helpers.js";

let h: Harness;
afterEach(async () => h?.close());

it("uses configured rewrite and local ranker providers in MCP search and context", async () => {
  let rewrites = 0;
  let rankings = 0;
  h = await harness("tiny", {
    loadLlm: () => ({
      available: true,
      provider: {
        id: "fake",
        generate: async (req) => {
          expect(req.refCount).toBe(0);
          rewrites++;
          return { text: '["ledger amounts", "money reports"]' };
        },
      },
    }),
    loadRanker: async (download) => {
      expect(download).toBe(false);
      return {
        available: true,
        provider: {
          id: "fake",
          score: async (_q, docs) => {
            rankings++;
            return docs.map(() => 0.5);
          },
        },
      };
    },
  });
  appendFileSync(
    join(h.dir, ".aimem/project.yaml"),
    "\nretrieval:\n  query_rewrite: llm\n  rerank: cross-encoder\n  llm:\n    allow_remote: true\n",
  );
  expect((await h.call("aimem_search", { query: "unusual wording", mode: "lexical" })).isError).toBe(false);
  expect((await h.call("aimem_context", { task: "money" })).isError).toBe(false);
  expect(rewrites).toBe(2);
  expect(rankings).toBe(2);
  const logs = readFileSync(join(h.dir, ".aimem/.cache/calls.jsonl"), "utf8");
  expect(logs).not.toContain("unusual wording");
  expect(
    logs
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s).kind),
  ).toEqual(["llm", "rerank.local", "llm", "rerank.local"]);
});

it("does not call a rewrite provider without consent and exposes fallback warnings", async () => {
  h = await harness("tiny", {
    loadLlm: () => {
      throw new Error("must not load");
    },
  });
  appendFileSync(
    join(h.dir, ".aimem/project.yaml"),
    "\nretrieval:\n  query_rewrite: llm\n  rerank: cross-encoder\n",
  );
  const result = await h.call("aimem_search", { query: "money", mode: "lexical" });
  expect(result.isError).toBe(false);
  expect(result.text).toMatch(/remote consent/);
  expect(result.text).toMatch(/cross-encoder/);
});
