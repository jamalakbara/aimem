import { cpSync, mkdtempSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildIndex,
  buildVectorCache,
  CHUNKER_VERSION,
  chunkRecord,
  hashEmbedder,
  loadIndex,
  loadProject,
  loadVectorCache,
  type Notebook,
  nodeFs,
  resolveEmbeddingProvider,
  semanticScores,
} from "@aimem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXTURES, fixedRandom } from "./helpers.js";

const deps = { fs: nodeFs, random: fixedRandom(9, 2) };
function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("expected a value");
  return v;
}
let root: string;
let nb: Notebook;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "aimem-embed-"));
  cpSync(join(FIXTURES, "tiny"), root, { recursive: true });
  nb = await loadProject(nodeFs, root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const index = () => loadIndex(nb, { fs: nodeFs });

describe("chunkRecord (15 §3)", () => {
  it("makes a head chunk plus one chunk per ## section, each prefixed with context", async () => {
    const rec = (await index()).records.find((r) => r.id === "dec-1a2b3c4d");
    const chunks = chunkRecord(must(rec));
    expect(chunks.map((c) => c.section)).toEqual([
      "head",
      "Context",
      "Decision",
      "Consequences",
      "Alternatives",
    ]);
    expect(chunks[0]?.text).toBe(
      "decision | Store money as integer minor units — All amounts are stored and computed as integer minor units (cents) with an explicit currency code. | tags: money, ledger, pinned | paths: src/ledger/**, db/migrations/**",
    );
    expect(chunks[1]?.text.startsWith("decision | Store money as integer minor units | ## Context\n")).toBe(
      true,
    );
    expect(new Set(chunks.map((c) => c.bodySha)).size).toBe(1);
  });

  it("uses a single body chunk for records without sections", async () => {
    const rec = (await index()).records.find((r) => r.id === "mem-5e6f7g8h");
    expect(chunkRecord(must(rec)).map((c) => c.section)).toEqual(["head", "body"]);
  });

  it("splits long sections into overlapping parts under the size limit", () => {
    const words = Array.from({ length: 900 }, (_, i) => `word${i}`).join(" ");
    const [rec] = buildIndex([
      {
        file: ".aimem/memory/mem-00000001-x.md",
        dirType: "memory",
        text: `---\naimem: 1\nid: mem-00000001\ntype: memory\ntitle: Long\nsummary: A long one.\nstatus: active\ntrust: agent\nroles: [dev]\nauthor: agent:x\ncreated: 2026-10-01T09:00:00Z\nupdated: 2026-10-01T09:00:00Z\n---\n\n## Notes\n${words}\n`,
      },
    ]).records;
    const parts = chunkRecord(must(rec)).filter((c) => c.section === "Notes");
    expect(parts.length).toBeGreaterThan(2);
    for (const p of parts) expect(Math.ceil(p.text.length / 4)).toBeLessThanOrEqual(330);
    const tail = must(parts[0]).text.split(" ").slice(-5);
    expect(must(parts[1]).text).toContain(tail.join(" ")); // overlap
    expect(parts.map((p) => p.part)).toEqual(parts.map((_, i) => i));
  });
});

describe("hashEmbedder (deterministic stub, 12 §3)", () => {
  it("is deterministic, normalised and word-overlap sensitive", async () => {
    const e = hashEmbedder(128);
    const [a, b, c] = await e.embed(
      ["integer minor units for money", "money stored as integer minor units", "kubernetes ingress helm"],
      "document",
    );
    expect(await e.embed(["integer minor units for money"], "query")).toEqual([a]);
    const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * (y[i] ?? 0), 0);
    expect(dot(must(a), must(a))).toBeCloseTo(1, 6);
    expect(dot(must(a), must(b))).toBeGreaterThan(dot(must(a), must(c)));
    expect(e.id).toBe("stub:hash-128");
  });
});

describe("resolveEmbeddingProvider", () => {
  it.each([
    [{ provider: "none" }, /provider is none/],
    [{ provider: "local" }, /no embedding provider loaded/],
    [{ provider: "openai-compatible" }, /no embedding provider loaded/],
    [undefined, /no embedding provider loaded/],
  ] as const)("%j is unavailable with a reason", (embeddings, reason) => {
    const s = resolveEmbeddingProvider({ ...nb.config, retrieval: embeddings ? { embeddings } : {} });
    expect(s.available).toBe(false);
    if (!s.available) expect(s.reason).toMatch(reason);
  });

  it("uses an injected provider unless embeddings are switched off", () => {
    expect(resolveEmbeddingProvider(nb.config, hashEmbedder()).available).toBe(true);
    expect(
      resolveEmbeddingProvider(
        { ...nb.config, retrieval: { embeddings: { provider: "none" } } },
        hashEmbedder(),
      ).available,
    ).toBe(false);
  });
});

describe("vector cache (15 §4.3, §5)", () => {
  const vecDir = () => join(root, ".aimem/.cache/vectors");

  it("builds, then reuses everything when nothing changed", async () => {
    const e = hashEmbedder(64);
    const first = await buildVectorCache(nb, await index(), e, deps);
    expect(first).toMatchObject({ reused: 0, removed: 0, rebuilt: true, excluded: [] });
    expect(first.built).toBe(first.chunks);
    expect(statSync(join(vecDir(), "vectors.f32")).size).toBe(first.chunks * 64 * 4);
    const meta = JSON.parse(readFileSync(join(vecDir(), "meta.json"), "utf8"));
    expect(meta).toMatchObject({
      version: 1,
      provider: "stub:hash-64",
      dimensions: 64,
      chunkerVersion: CHUNKER_VERSION,
    });
    const again = await buildVectorCache(nb, await index(), e, deps);
    expect(again).toMatchObject({ built: 0, reused: first.chunks, removed: 0, rebuilt: false });
  });

  it("re-embeds only the edited record", async () => {
    const e = hashEmbedder(64);
    const first = await buildVectorCache(nb, await index(), e, deps);
    const file = join(root, ".aimem/memory/mem-6f7g8h9j-monthly-reports-must-reconcile-to-the-cent.md");
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace("there is no tolerance.", "there is no tolerance at all."),
    );
    const r = await buildVectorCache(nb, await index(), e, deps);
    expect(r.built).toBe(2); // head + body of the edited memory
    expect(r.removed).toBe(2);
    expect(r.reused).toBe(first.chunks - 2);
  });

  it.each([
    ["model change", hashEmbedder(64), hashEmbedder(64, "other")],
    ["dimension change", hashEmbedder(64), hashEmbedder(32)],
  ])("%s triggers a full rebuild", async (_n, a, b) => {
    await buildVectorCache(nb, await index(), a, deps);
    const r = await buildVectorCache(nb, await index(), b, deps);
    expect(r).toMatchObject({ rebuilt: true, reused: 0 });
    expect(r.reason).toMatch(/model|dimensions/);
  });

  it("detects a corrupt cache and rebuilds", async () => {
    const e = hashEmbedder(64);
    await buildVectorCache(nb, await index(), e, deps);
    truncateSync(join(vecDir(), "vectors.f32"), 10);
    expect((await loadVectorCache(nodeFs, nb)).problem).toMatch(/corrupt|size/);
    const r = await buildVectorCache(nb, await index(), e, deps);
    expect(r.rebuilt).toBe(true);
  });

  it("--rebuild discards the cache", async () => {
    const e = hashEmbedder(64);
    await buildVectorCache(nb, await index(), e, deps);
    expect(await buildVectorCache(nb, await index(), e, deps, { rebuild: true })).toMatchObject({
      rebuilt: true,
      reused: 0,
      reason: "rebuild requested",
    });
  });

  it("never embeds no-embed or secret-flagged records, and says so", async () => {
    const mem = join(root, ".aimem/memory/mem-6f7g8h9j-monthly-reports-must-reconcile-to-the-cent.md");
    writeFileSync(
      mem,
      readFileSync(mem, "utf8").replace("tags: [reporting, money]", "tags: [reporting, money, no-embed]"),
    );
    const task = join(root, ".aimem/tasks/tsk-4d5e6f7g-write-rounding-tests-for-fee-splits.md");
    writeFileSync(
      task,
      readFileSync(task, "utf8").replace(
        "## Notes\n",
        `## Notes\nkey ${["AKIA", "IOSFODNN7", "EXAMPLE"].join("")}\n`,
      ),
    );
    const r = await buildVectorCache(nb, await index(), hashEmbedder(64), deps);
    expect(r.excluded).toEqual([
      { ref: "mem-6f7g8h9j", reason: "tagged no-embed" },
      { ref: "tsk-4d5e6f7g", reason: "possible secret" },
    ]);
    const meta = JSON.parse(readFileSync(join(vecDir(), "meta.json"), "utf8"));
    expect(
      meta.chunks.some((c: { ref: string }) => c.ref === "mem-6f7g8h9j" || c.ref === "tsk-4d5e6f7g"),
    ).toBe(false);
  });
});

describe("semanticScores", () => {
  it("scores records by their best chunk; the matching record ranks first", async () => {
    const e = hashEmbedder(256);
    await buildVectorCache(nb, await index(), e, deps);
    const { cache } = await loadVectorCache(nodeFs, nb);
    const scores = await semanticScores(must(cache), e, "webhook payloads carry amounts as strings");
    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    expect(ranked[0]?.[0]).toBe("mem-5e6f7g8h");
    for (const [, s] of ranked) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it("refuses a cache built with a different provider", async () => {
    await buildVectorCache(nb, await index(), hashEmbedder(64), deps);
    const { cache } = await loadVectorCache(nodeFs, nb);
    await expect(semanticScores(must(cache), hashEmbedder(32), "money")).rejects.toThrow(/different/);
  });
});

describe("performance", () => {
  it("chunks, embeds and searches 5,000 records with the stub in a few seconds", async () => {
    const texts = Array.from({ length: 5000 }, (_, i) => {
      const id = `mem-${String(i).padStart(8, "0")}`;
      return {
        file: `.aimem/memory/${id}-x.md`,
        dirType: "memory" as const,
        text: `---\naimem: 1\nid: ${id}\ntype: memory\ntitle: Note ${i} about ledger ${i % 17}\nsummary: Summary ${i} for webhook ${i % 13}.\nstatus: active\ntrust: agent\nroles: [dev]\nauthor: agent:x\ncreated: 2026-10-01T09:00:00Z\nupdated: 2026-10-01T09:00:00Z\n---\n\n${"retry idempotent handler ".repeat(20)}\n`,
      };
    });
    const big = buildIndex(texts);
    const t0 = performance.now();
    const e = hashEmbedder(256);
    const r = await buildVectorCache(nb, big, e, deps);
    const { cache } = await loadVectorCache(nodeFs, nb);
    await semanticScores(must(cache), e, "ledger webhook retry");
    expect(r.chunks).toBe(10000);
    expect(performance.now() - t0).toBeLessThan(8000);
  });
});
