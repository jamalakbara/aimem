import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addRecord,
  buildVectorCache,
  type EmbeddingProvider,
  hashEmbedder,
  loadIndex,
  loadProject,
  loadVectorCache,
  type Notebook,
  nodeFs,
  semanticForQuery,
  supersedeRecord,
  updateRecord,
  VECTOR_DIR,
  verifyRecords,
} from "@aimem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";

let root: string;
let nb: Notebook;
let n = 0;
const random = {
  bytes: (k: number) =>
    Uint8Array.from({ length: k }, () => {
      n += 7;
      return n % 256;
    }),
};
const clock = { now: () => new Date("2026-11-16T09:00:00Z") };

/** Stub embedder that counts the texts it embeds. */
function counting(base = hashEmbedder(64)) {
  const calls: string[][] = [];
  const provider: EmbeddingProvider = {
    ...base,
    async embed(texts, kind) {
      calls.push(texts);
      return base.embed(texts, kind);
    },
  };
  return { provider, calls, embedded: () => calls.flat().length };
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "aimem-embed-write-"));
  cpSync(join(FIXTURES, "tiny"), root, { recursive: true });
  nb = await loadProject(nodeFs, root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const index = () => loadIndex(nb, { fs: nodeFs });
async function seedCache(provider: EmbeddingProvider) {
  await buildVectorCache(nb, await index(), provider, { fs: nodeFs, random });
}
async function chunkKeys(): Promise<Map<string, string[]>> {
  const { cache } = await loadVectorCache(nodeFs, nb);
  const out = new Map<string, string[]>();
  for (const c of cache?.meta.chunks ?? []) out.set(c.ref, [...(out.get(c.ref) ?? []), c.key]);
  return out;
}
async function coverage(provider: EmbeddingProvider): Promise<number | undefined> {
  const s = await semanticForQuery(nb, await index(), provider, "", { fs: nodeFs });
  return "coverage" in s ? s.coverage : undefined;
}
const addMemory = (embedder: EmbeddingProvider | undefined, extra: { tags?: string[]; body?: string } = {}) =>
  addRecord(
    nb,
    {
      type: "memory",
      title: "Retry webhook deliveries with jitter",
      summary: "Webhook retries back off exponentially with random jitter to avoid thundering herds.",
      author: "agent:test",
      body: extra.body ?? "## Notes\nJitter is 0-30% of the delay.\n",
      ...(extra.tags ? { tags: extra.tags } : {}),
    },
    { fs: nodeFs, clock, random, ...(embedder ? { embedder } : {}) },
  );

describe("incremental embeddings after record writes (15 §4.3, §13)", () => {
  it("add embeds only the new record's chunks and keeps every other key", async () => {
    const stub = counting();
    await seedCache(stub.provider);
    const before = await chunkKeys();
    const embeddedBefore = stub.embedded();

    const r = await addMemory(stub.provider);

    const after = await chunkKeys();
    expect(after.get(r.ref)?.length).toBeGreaterThan(0);
    expect(stub.embedded() - embeddedBefore).toBe(after.get(r.ref)?.length);
    for (const [ref, keys] of before) expect(after.get(ref)).toEqual(keys);
    expect(await coverage(stub.provider)).toBe(1);
    expect(r.warnings).toEqual([]);
    expect(r.changed.some((f) => f.includes(".cache"))).toBe(false);
  });

  it("update re-embeds only the changed record", async () => {
    const stub = counting();
    await seedCache(stub.provider);
    const target = (await index()).records.find((r) => r.type === "decision" && !r.fm.managed_by);
    if (!target) throw new Error("fixture has records");
    const before = await chunkKeys();
    const embeddedBefore = stub.embedded();

    await updateRecord(
      nb,
      target.id,
      { author: "agent:test", body: "## Notes\nA completely new body about ledgers.\n" },
      { fs: nodeFs, clock, random, embedder: stub.provider },
    );

    const after = await chunkKeys();
    expect(after.get(target.id)).not.toEqual(before.get(target.id));
    expect(stub.embedded() - embeddedBefore).toBeGreaterThan(0);
    expect(stub.embedded() - embeddedBefore).toBeLessThanOrEqual(after.get(target.id)?.length ?? 0);
    for (const [ref, keys] of before) if (ref !== target.id) expect(after.get(ref)).toEqual(keys);
    expect(await coverage(stub.provider)).toBe(1);
  });

  it("supersede and verify keep the cache complete", async () => {
    const stub = counting();
    await seedCache(stub.provider);
    const a = await addMemory(stub.provider);
    const b = await addRecord(
      nb,
      {
        type: "memory",
        title: "Webhook retries use capped exponential backoff",
        summary: "Retries back off exponentially up to a cap of ten minutes.",
        author: "agent:test",
        body: "## Notes\nCap is ten minutes.\n",
      },
      { fs: nodeFs, clock, random, embedder: stub.provider },
    );
    await supersedeRecord(nb, a.ref, b.ref, { fs: nodeFs, clock, random, embedder: stub.provider });
    const v = await verifyRecords(nb, [b.ref], "human:tester", {
      fs: nodeFs,
      clock,
      random,
      embedder: stub.provider,
    });
    expect(v.warnings).toEqual([]);
    expect(await coverage(stub.provider)).toBe(1);
  });

  it("never starts a cold build: with no cache, writes create no vector files", async () => {
    const stub = counting();
    await addMemory(stub.provider);
    expect(stub.embedded()).toBe(0);
    expect(existsSync(join(nb.dir, VECTOR_DIR))).toBe(false);
  });

  it("skips when the cache was built with a different provider", async () => {
    await seedCache(hashEmbedder(64, "other"));
    const stub = counting();
    const r = await addMemory(stub.provider);
    expect(stub.embedded()).toBe(0);
    expect(r.warnings).toEqual([]);
    expect((await loadVectorCache(nodeFs, nb)).cache?.meta.provider).toBe("stub:hash-64:other");
  });

  it("a failing provider never fails the write; it warns and the next write catches up", async () => {
    const stub = counting();
    await seedCache(stub.provider);
    const broken: EmbeddingProvider = {
      ...stub.provider,
      async embed() {
        throw new Error("model crashed");
      },
    };
    const r = await addMemory(broken);
    expect(existsSync(join(root, r.file))).toBe(true);
    expect(r.warnings.join("\n")).toMatch(/embeddings not updated: model crashed/);
    expect(await coverage(stub.provider)).toBeLessThan(1);

    await addRecord(
      nb,
      {
        type: "memory",
        title: "Queue names are kebab-case",
        summary: "All queue names use kebab-case.",
        author: "agent:test",
        body: "## Notes\nExample: billing-events.\n",
      },
      { fs: nodeFs, clock, random, embedder: stub.provider },
    );
    expect(await coverage(stub.provider)).toBe(1);
  });

  it("no-embed records are still excluded", async () => {
    const stub = counting();
    await seedCache(stub.provider);
    const r = await addMemory(stub.provider, { tags: ["no-embed"] });
    expect((await chunkKeys()).has(r.ref)).toBe(false);
    expect((await loadVectorCache(nodeFs, nb)).cache?.meta.excluded).toContain(r.ref);
    expect(await coverage(stub.provider)).toBe(1);
  });

  it("without an embedder, writes leave the cache untouched", async () => {
    const stub = counting();
    await seedCache(stub.provider);
    const before = await chunkKeys();
    const r = await addMemory(undefined);
    expect(await chunkKeys()).toEqual(before);
    expect(r.warnings).toEqual([]);
  });
});
