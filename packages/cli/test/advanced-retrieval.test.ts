import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { cli, FIXTURES } from "./helpers.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aimem-advanced-"));
  cpSync(join(FIXTURES, "tiny"), dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const config = (text: string) => appendFileSync(join(dir, ".aimem/project.yaml"), `\nretrieval:\n${text}\n`);

it("rewrites CLI search only with consent and logs query-only generation", async () => {
  config("  query_rewrite: llm\n  llm:\n    allow_remote: true");
  let calls = 0;
  const r = await cli(["search", "unusual terminology", "--mode", "lexical", "--dir", dir, "--json"], {
    loadLlm: () => ({
      available: true,
      provider: {
        id: "fake",
        generate: async (req) => {
          calls++;
          expect(req.refCount).toBe(0);
          return { text: '["ledger amounts", "money reports"]' };
        },
      },
    }),
  });
  expect(r.code).toBe(0);
  expect(calls).toBe(1);
  expect(r.json.data.hits.length).toBeGreaterThan(0);
  const logs = readFileSync(join(dir, ".aimem/.cache/calls.jsonl"), "utf8");
  expect(logs).not.toContain("unusual terminology");
  expect(JSON.parse(logs).refCount).toBe(0);
});

it("wires local ranking into search and context without downloading", async () => {
  config("  rerank: cross-encoder");
  let calls = 0;
  const loadRanker = async (allowDownload: boolean) => {
    expect(allowDownload).toBe(false);
    return {
      available: true as const,
      provider: {
        id: "fake",
        score: async (_q: string, docs: string[]) => {
          calls++;
          return docs.map(() => 0.5);
        },
      },
    };
  };
  for (const args of [
    ["search", "money"],
    ["context", "--task", "money"],
  ]) {
    const r = await cli([...args, "--mode", "lexical", "--dir", dir, "--json"], { loadRanker });
    expect(r.code).toBe(0);
    expect(r.json.warnings).toEqual([]);
  }
  expect(calls).toBe(2);
});

it("falls back to identical search results when the local model is unavailable", async () => {
  const args = ["search", "money", "--mode", "lexical", "--dir", dir, "--json"];
  const baseline = await cli(args);
  config("  rerank: cross-encoder");
  const result = await cli(args);
  expect(result.json.data).toEqual(baseline.json.data);
  expect(result.json.warnings.join(" ")).toMatch(/cross-encoder/);
});

it("combines ask rewriting and local ranking and logs each actual invocation", async () => {
  config("  query_rewrite: llm\n  rerank: cross-encoder\n  llm:\n    allow_remote: true");
  let calls = 0;
  const r = await cli(["ask", "money", "--mode", "lexical", "--dir", dir, "--json"], {
    loadLlm: () => ({
      available: true,
      provider: {
        id: "fake",
        generate: async (req) => {
          calls++;
          return {
            text: req.refCount === 0 ? '["ledger amounts", "money reports"]' : "Amounts [dec-1a2b3c4d].",
          };
        },
      },
    }),
    loadRanker: async () => ({
      available: true,
      provider: { id: "fake", score: async (_q, docs) => docs.map(() => 0.5) },
    }),
  });
  expect(r.code).toBe(0);
  expect(calls).toBe(2);
  const rows = readFileSync(join(dir, ".aimem/.cache/calls.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  expect(rows.map((r) => r.kind)).toEqual(["llm", "rerank.local", "llm"]);
  expect(rows[0].refCount).toBe(0);
});
