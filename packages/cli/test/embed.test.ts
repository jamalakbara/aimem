import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashEmbedder } from "@aimem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cli, FIXTURES, fakeGit } from "./helpers.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aimem-cli-embed-"));
  cpSync(join(FIXTURES, "tiny"), dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("aimem index --embeddings", () => {
  it("without a model: semantic search stays off, keyword search keeps working, exit 0", async () => {
    const r = await cli(["index", "--embeddings", "--json", "--dir", dir]);
    expect(r.code).toBe(0);
    expect(r.json.data.embeddings).toEqual({
      available: false,
      reason: "the local embedding model arrives in slice 2.4",
    });
    expect(r.json.warnings.join(" ")).toMatch(/semantic search is off/);
    const s = await cli(["search", "integer minor units", "--json", "--dir", dir]);
    expect(s.json.data.hits[0].ref).toBe("dec-1a2b3c4d");
    const c = await cli(["context", "--task", "money", "--json", "--dir", dir]);
    expect(c.json.data.header.semanticSearch).toBe("off");
  });

  it("with an embedder: builds, then reuses; --rebuild starts over", async () => {
    const embedder = hashEmbedder(64);
    const first = await cli(["index", "--embeddings", "--json", "--dir", dir], { embedder });
    expect(first.json.data.embeddings).toMatchObject({
      available: true,
      provider: "stub:hash-64",
      reused: 0,
      excluded: [],
    });
    const chunks = first.json.data.embeddings.chunks;
    expect(chunks).toBeGreaterThan(8);
    const again = await cli(["index", "--embeddings", "--json", "--dir", dir], { embedder });
    expect(again.json.data.embeddings).toMatchObject({ built: 0, reused: chunks });
    const rebuilt = await cli(["index", "--rebuild", "--json", "--dir", dir], { embedder });
    expect(rebuilt.json.data.embeddings).toMatchObject({ rebuilt: true, reused: 0 });
  });

  it("doctor reports the embedding status and cache", async () => {
    const off = await cli(["doctor", "--json", "--dir", dir], { git: fakeGit() });
    const search = (r: typeof off) => r.json.data.checks.find((c: { name: string }) => c.name === "search");
    expect(search(off).detail).toMatch(
      /semantic search off: the local embedding model arrives in slice 2\.4/,
    );
    const embedder = hashEmbedder(64);
    await cli(["index", "--embeddings", "--dir", dir], { embedder });
    const on = await cli(["doctor", "--json", "--dir", dir], { git: fakeGit(), embedder });
    expect(search(on)).toMatchObject({ status: "ok" });
    expect(search(on).detail).toMatch(/semantic search ready: stub:hash-64, \d+ chunks cached/);
  });

  it("with a model and cache, context and search run hybrid", async () => {
    const embedder = hashEmbedder(128);
    await cli(["index", "--embeddings", "--dir", dir], { embedder });
    const c = await cli(["context", "--task", "integer minor units", "--json", "--dir", dir], { embedder });
    expect(c.json.data.header).toMatchObject({
      semanticSearch: "on",
      semanticModel: "stub:hash-128",
      semanticCoverage: 1,
      fusion: "weighted",
    });
    expect(c.json.data.markdown).toContain("> semantic search: on (stub:hash-128, coverage 100%)");
    const s = await cli(["search", "integer minor units", "--json", "--dir", dir], { embedder });
    expect(s.json.data).toMatchObject({ mode: "hybrid", semanticModel: "stub:hash-128" });
    expect(s.json.data.hits[0].ref).toBe("dec-1a2b3c4d");
    const lex = await cli(["search", "integer minor units", "--mode", "lexical", "--json", "--dir", dir], {
      embedder,
    });
    expect(lex.json.data).toMatchObject({ mode: "lexical", semanticReason: "lexical mode" });
  });

  it("a stale cache from another model falls back with the reason", async () => {
    await cli(["index", "--embeddings", "--dir", dir], { embedder: hashEmbedder(64) });
    const c = await cli(["context", "--task", "money", "--mode", "hybrid", "--json", "--dir", dir], {
      embedder: hashEmbedder(128),
    });
    expect(c.json.data.header.semanticSearch).toBe("off");
    expect(c.json.warnings.join(" ")).toMatch(/different provider/);
  });
});
