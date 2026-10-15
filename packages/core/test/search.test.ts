import { join } from "node:path";
import { buildIndex, loadIndex, loadProject, nodeFs, search, tokenize } from "@aimem/core";
import { beforeAll, describe, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";

type Index = Awaited<ReturnType<typeof loadIndex>>;
let medium: Index;
beforeAll(async () => {
  medium = await loadIndex(await loadProject(nodeFs, join(FIXTURES, "medium")), { fs: nodeFs });
});

const titles = (hits: ReturnType<typeof search>) => hits.map((h) => h.record.title);

describe("tokenize", () => {
  it("lowercases, folds accents, splits on non-letters, keeps digits, no stemming", () => {
    expect(tokenize("Café déjà-vu: Ringkasan HARUS satu baris (V009), chars/4")).toEqual([
      "cafe",
      "deja",
      "vu",
      "ringkasan",
      "harus",
      "satu",
      "baris",
      "v009",
      "chars",
      "4",
    ]);
    expect(tokenize("running runs")).toEqual(["running", "runs"]);
  });
});

describe("loadIndex", () => {
  it("indexes every valid record and reports broken ones without failing", async () => {
    expect(medium.records).toHaveLength(127);
    expect(medium.problems).toEqual([]);
    const messy = await loadIndex(await loadProject(nodeFs, join(FIXTURES, "messy")), { fs: nodeFs });
    expect(messy.problems.map((p) => p.file).sort()).toEqual([
      ".aimem/decisions/dec-0000000a-unclosed-flow-sequence.md",
      ".aimem/memory/mem-0000000b-no-frontmatter.md",
      ".aimem/tasks/tsk-0000000c-missing-summary.md",
      ".aimem/tasks/tsk-0000000d-unknown-trust-level.md",
    ]);
  });

  it("orders records by id regardless of input order", () => {
    const a = buildIndex(
      [...medium.records].reverse().map((r) => ({ file: r.file, dirType: r.type, text: r.text })),
    );
    expect(a.records.map((r) => r.id)).toEqual(medium.records.map((r) => r.id));
  });
});

describe("search (BM25)", () => {
  it("finds the matching decision first, with scores normalised to 0..1", () => {
    const hits = search(medium, "zod json schema");
    expect(hits[0]?.record.title).toBe("Use Zod 4 for schemas and JSON Schema export");
    expect(hits[0]?.score).toBe(1);
    for (const h of hits) expect(h.score).toBeGreaterThan(0);
    for (const h of hits) expect(h.score).toBeLessThanOrEqual(1);
  });

  it("works for Indonesian queries", () => {
    expect(titles(search(medium, "anggaran token"))[0]).toBe("Anggaran token dihitung dengan chars/4");
    expect(titles(search(medium, "jangan edit index manual"))[0]).toBe("Jangan edit INDEX.md secara manual");
  });

  it("hides superseded, rejected, cancelled, done and retired records unless asked", () => {
    const hidden = new Set(["superseded", "rejected", "cancelled", "done", "retired"]);
    expect(search(medium, "zod", { limit: 100 }).some((h) => hidden.has(h.record.status))).toBe(false);
    expect(titles(search(medium, "zod", { includeSuperseded: true }))).toContain(
      "Use Zod 3 with passthrough objects",
    );
    expect(titles(search(medium, "scaffold monorepo", { limit: 100 }))).not.toContain(
      "Scaffold the monorepo",
    );
    expect(titles(search(medium, "scaffold monorepo", { statuses: ["done"] }))).toContain(
      "Scaffold the monorepo",
    );
  });

  it.each([
    ["types", { types: ["memory"] }, (r: Index["records"][number]) => r.type === "memory"],
    ["tags", { tags: ["yaml"] }, (r: Index["records"][number]) => r.tags.includes("yaml")],
    [
      "roles",
      { roles: ["analyst"] },
      (r: Index["records"][number]) => r.roles.includes("analyst") || r.roles.includes("all"),
    ],
    ["statuses", { statuses: ["blocked"] }, (r: Index["records"][number]) => r.status === "blocked"],
  ] as const)("filters by %s", (_name, opts, ok) => {
    const hits = search(medium, "aimem agents records notebook decision task yaml frontmatter", {
      ...opts,
      limit: 200,
    });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(ok(h.record)).toBe(true);
  });

  it("filters by path: records whose globs cover the given file", () => {
    const hits = search(medium, "schema", { paths: ["packages/schema/src/record.ts"], limit: 50 });
    expect(titles(hits)).toEqual(
      expect.arrayContaining([
        "Use Zod 4 for schemas and JSON Schema export",
        "Schemas never inject defaults",
      ]),
    );
    for (const h of hits) expect(h.record.paths.some((p) => p.startsWith("packages/schema"))).toBe(true);
  });

  it("respects the limit and returns nothing for an empty query", () => {
    expect(search(medium, "the", { limit: 3 }).length).toBeLessThanOrEqual(3);
    expect(search(medium, "   ")).toEqual([]);
  });

  it("is deterministic: same query, same order, ties broken by id", () => {
    const a = search(medium, "agent", { limit: 50 });
    const b = search(
      buildIndex([...medium.records].reverse().map((r) => ({ file: r.file, dirType: r.type, text: r.text }))),
      "agent",
      { limit: 50 },
    );
    expect(b.map((h) => h.record.id)).toEqual(a.map((h) => h.record.id));
    for (let i = 1; i < a.length; i++) {
      const [p, c] = [a[i - 1], a[i]];
      if (p && c && p.raw === c.raw) expect(p.record.id < c.record.id).toBe(true);
    }
  });
});
