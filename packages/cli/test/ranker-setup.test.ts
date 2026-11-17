import { appendFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { cli, FIXTURES } from "./helpers.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aimem-ranker-setup-"));
  cpSync(join(FIXTURES, "tiny"), dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it("doctor checks a configured ranker without permitting downloads", async () => {
  appendFileSync(join(dir, ".aimem/project.yaml"), "\nretrieval:\n  rerank: cross-encoder\n");
  const result = await cli(["doctor", "--dir", dir, "--json"], {
    loadRanker: async (download) => {
      expect(download).toBe(false);
      return { available: false, reason: "not cached" };
    },
  });
  expect(result.code).toBe(0);
  expect(result.json.data.checks).toContainEqual({
    name: "local reranker",
    status: "warn",
    detail: "not cached",
  });
});
it("requires explicit index --reranker for downloads", async () => {
  let calls = 0;
  const r = await cli(["index", "--reranker", "--dir", dir, "--json"], {
    loadRanker: async (download) => {
      calls++;
      expect(download).toBe(true);
      return { available: true, provider: { id: "fake", score: async () => [] } };
    },
  });
  expect(r.code).toBe(0);
  expect(calls).toBe(1);
  expect(r.json.data.reranker).toEqual({ available: true, provider: "fake" });
});
