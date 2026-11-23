import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addRecord,
  buildVectorCache,
  cryptoRandom,
  type EmbeddingProvider,
  hashEmbedder,
  loadIndex,
  loadProject,
  loadVectorCache,
  MAX_RECORD_CHUNKS,
  MAX_RECORD_TERMS,
  type Notebook,
  nodeFs,
  search,
} from "../src/index.js";
import { FIXTURES } from "./helpers.js";

let root: string;
let nb: Notebook;
const deps = { fs: nodeFs, clock: { now: () => new Date("2026-11-23T10:00:00Z") }, random: cryptoRandom };
const letters = (n: number) => {
  let s = "";
  for (let i = n + 1; i > 0; i = Math.floor(i / 26)) s += String.fromCharCode(97 + (i % 26));
  return `aa${s.padEnd(4, "q")}`; // sorts before ordinary words, so it would win ties for the 4,096 slots
};
/** Vocabulary vectors exist for local providers only. */
const local = (): EmbeddingProvider => ({ ...hashEmbedder(32), id: "local:stub" });

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "aimem-embed-cap-"));
  cpSync(join(FIXTURES, "tiny"), root, { recursive: true });
  nb = await loadProject(nodeFs, root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const addLong = async () =>
  addRecord(
    nb,
    {
      type: "memory",
      title: "Dense handbook",
      summary: "A very long document.",
      body: `${Array.from({ length: 60_000 }, (_, i) => letters(i % 5000)).join(" ")} lastwordonly`,
      author: "human:dana",
    },
    deps,
  );
const build = async () => {
  const r = await buildVectorCache(nb, await loadIndex(nb, { fs: nodeFs }), local(), {
    fs: nodeFs,
    random: cryptoRandom,
  });
  const { cache } = await loadVectorCache(nodeFs, nb);
  return { r, rows: cache?.meta.chunks ?? [] };
};

describe("one long record cannot dominate the vector cache (QA #104)", () => {
  it("caps text chunks and vocabulary words per record, and reports it", async () => {
    const plain = await build();
    expect(plain.r.truncated).toEqual([]);
    const long = await addLong();
    const { r, rows } = await build();
    const text = rows.filter((c) => c.ref === long.ref && c.term === undefined);
    const terms = rows.filter((c) => c.ref === long.ref && c.term !== undefined);
    expect(text).toHaveLength(MAX_RECORD_CHUNKS);
    expect(terms.length).toBeLessThanOrEqual(MAX_RECORD_TERMS);
    expect(r.truncated).toEqual([{ ref: long.ref, chunks: expect.any(Number), embedded: MAX_RECORD_CHUNKS }]);
    expect(r.truncated[0]?.chunks).toBeGreaterThan(MAX_RECORD_CHUNKS);
  });

  it("leaves the vectors of ordinary records unchanged", async () => {
    const before = (await build()).rows.map((c) => c.key);
    await addLong();
    const after = new Set((await build()).rows.map((c) => c.key));
    expect(before.filter((k) => !after.has(k))).toEqual([]);
  });

  it("keyword search still covers the whole text", async () => {
    const long = await addLong();
    const hits = search(await loadIndex(nb, { fs: nodeFs }), "lastwordonly", { limit: 3 });
    expect(hits[0]?.record.id).toBe(long.ref);
  });
});
