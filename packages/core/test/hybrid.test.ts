import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildBriefing,
  buildIndex,
  buildQuery,
  buildVectorCache,
  hashEmbedder,
  loadIndex,
  loadProject,
  type Notebook,
  type NotebookIndex,
  nodeFs,
  search,
  semanticForQuery,
} from "@aimem/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, fixedRandom } from "./helpers.js";

const NOW = new Date("2026-10-12T00:00:00Z");
let root: string;
let nb: Notebook;
let index: NotebookIndex;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "aimem-hybrid-"));
  cpSync(join(FIXTURES, "medium"), root, { recursive: true });
  nb = await loadProject(nodeFs, root);
  index = await loadIndex(nb, { fs: nodeFs });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const sem = (entries: [string, number][], coverage = 1) => ({
  scores: new Map(entries),
  provider: "test",
  coverage,
});

describe("hybrid scoring (15 §6)", () => {
  it("without semantic input the lexical-only weights apply and semantic is 0", () => {
    const b = buildBriefing(nb, index, { task: "zod json schema export" }, NOW);
    expect(b.header.semanticSearch).toBe("off");
    for (const e of b.explain) expect(e.parts.semantic).toBe(0);
    expect(b.markdown).toContain("> semantic search: off · live claims: off (arrive in M3)");
  });

  it("with semantic input uses 0.25 lexical + 0.25 semantic and admits semantic-only matches", () => {
    const lexicalOnly = buildBriefing(nb, index, { task: "wipe obsolete item" }, NOW);
    expect(lexicalOnly.explain.some((e) => e.ref === "dec-b0gymeq0")).toBe(false);
    const b = buildBriefing(
      nb,
      index,
      { task: "wipe obsolete item", semantic: sem([["dec-b0gymeq0", 0.9]]) },
      NOW,
    );
    const row = b.explain.find((e) => e.ref === "dec-b0gymeq0");
    expect(row?.parts.semantic).toBe(0.9);
    expect(row?.parts.lexical).toBe(0);
    expect(b.decisions.some((d) => d.ref === "dec-b0gymeq0")).toBe(true);
  });

  it("hard filters run first: similarity never resurrects a superseded record", () => {
    const b = buildBriefing(nb, index, { task: "zod", semantic: sem([["dec-0b20v421", 1]]) }, NOW);
    expect(b.explain.some((e) => e.ref === "dec-0b20v421")).toBe(false);
  });

  it("caps semantic-only candidates at the top 50", () => {
    const all = index.records.map((r, i) => [r.id, 0.01 + i / 1000] as [string, number]);
    const b = buildBriefing(nb, index, { task: "kubernetes helm ingress", semantic: sem(all) }, NOW);
    const semanticOnly = b.explain.filter(
      (e) => e.parts.lexical === 0 && e.parts.paths === 0 && e.parts.links === 0 && !e.pin,
    );
    expect(semanticOnly.length).toBeLessThanOrEqual(50);
  });

  it("reciprocal rank fusion is selectable and deterministic", () => {
    const input = {
      task: "agent commits",
      semantic: sem([
        ["dec-ek66gxgx", 0.8],
        ["dec-acwbjc55", 0.7],
      ]),
      fusion: "rrf" as const,
    };
    const a = buildBriefing(nb, index, input, NOW);
    const b = buildBriefing(nb, index, input, NOW);
    expect(a.markdown).toBe(b.markdown);
    expect(a.header.fusion).toBe("rrf");
  });

  it("the header shows the model and coverage, or the reason semantic search is off", () => {
    const on = buildBriefing(
      nb,
      index,
      { task: "zod", semantic: { ...sem([]), provider: "stub:hash-64", coverage: 0.73 } },
      NOW,
    );
    expect(on.markdown).toContain("> semantic search: on (stub:hash-64, coverage 73%)");
    expect(on.header).toMatchObject({
      semanticSearch: "on",
      semanticModel: "stub:hash-64",
      semanticCoverage: 0.73,
    });
    const off = buildBriefing(
      nb,
      index,
      { task: "zod", semanticOff: "the local embedding model arrives in slice 2.4" },
      NOW,
    );
    expect(off.markdown).toContain("> semantic search: off (the local embedding model arrives in slice 2.4)");
  });
});

describe("link expansion (15 §8)", () => {
  it("a link to a superseded record counts for the head of its supersede chain", () => {
    const rec = (id: string, extra: string) =>
      `---\naimem: 1\nid: ${id}\ntype: decision\ntitle: Title ${id}\nsummary: Summary of ${id}.\nstatus: accepted\ntrust: verified\nroles: [dev]\nauthor: human:x\ncreated: 2026-10-01T09:00:00Z\nupdated: 2026-10-01T09:00:00Z\n${extra}---\n\nbody\n`;
    const idx = buildIndex([
      {
        file: ".aimem/decisions/dec-0000000a-a.md",
        dirType: "decision",
        text: rec("dec-0000000a", "links: [dec-0000000b]\n").replace(
          "Title dec-0000000a",
          "Ledger rounding policy",
        ),
      },
      {
        file: ".aimem/decisions/dec-0000000b-b.md",
        dirType: "decision",
        text: rec("dec-0000000b", "superseded_by: dec-0000000c\n").replace(
          "status: accepted",
          "status: superseded",
        ),
      },
      {
        file: ".aimem/decisions/dec-0000000c-c.md",
        dirType: "decision",
        text: rec("dec-0000000c", "supersedes: dec-0000000b\n"),
      },
    ]);
    const b = buildBriefing(
      { ...nb, config: { ...nb.config, repo: undefined } },
      idx,
      { task: "ledger rounding policy" },
      NOW,
    );
    expect(b.explain.find((e) => e.ref === "dec-0000000c")?.parts.links).toBe(1);
    expect(b.explain.some((e) => e.ref === "dec-0000000b")).toBe(false);
  });
});

describe("semanticForQuery and hybrid search", () => {
  it("returns scores and coverage from the cache, or a reason", async () => {
    const e = hashEmbedder(128);
    const before = await semanticForQuery(nb, index, e, "zod", { fs: nodeFs });
    expect("reason" in before && before.reason).toMatch(/no vector cache/);
    await buildVectorCache(nb, index, e, { fs: nodeFs, random: fixedRandom(4) });
    const s = await semanticForQuery(nb, index, e, "zod json schema export", { fs: nodeFs });
    expect("scores" in s).toBe(true);
    if ("scores" in s) {
      expect(s.provider).toBe("stub:hash-128");
      expect(s.coverage).toBe(1);
      const top = [...s.scores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      expect(top).toBe("dec-094vmt9t");
    }
    const other = await semanticForQuery(nb, index, hashEmbedder(64), "zod", { fs: nodeFs });
    expect("reason" in other && other.reason).toMatch(/different provider/);
  });

  it("buildQuery joins task, branch words, the ref task and path tags", () => {
    const q = buildQuery(nb, index, {
      task: "fix retries",
      branch: "feat/webhook-retry",
      paths: ["packages/schema/src/x.ts"],
    });
    expect(q).toContain("fix retries");
    expect(q).toContain("webhook retry");
    expect(q).toContain("schema");
  });

  it("search blends semantic scores when given and stays lexical otherwise", () => {
    const lexical = search(index, "wipe obsolete item", { limit: 5 });
    expect(lexical.map((h) => h.record.id)).not.toContain("dec-b0gymeq0");
    const hybrid = search(
      index,
      "wipe obsolete item",
      { limit: 5 },
      { scores: new Map([["dec-b0gymeq0", 0.9]]) },
    );
    expect(hybrid[0]?.record.id).toBe("dec-b0gymeq0");
    expect(
      search(index, "erase", { limit: 5 }, { scores: new Map([["dec-0b20v421", 1]]) }).map(
        (h) => h.record.id,
      ),
    ).not.toContain("dec-0b20v421");
  });
});

describe("eval runner with semantic scores (smoke, stub embedder)", () => {
  it("runs the medium set hybrid: budget, determinism and no violations hold", async () => {
    const { readFileSync } = await import("node:fs");
    const YAML = (await import("yaml")).default;
    const { runEvalSet } = await import("@aimem/core");
    const set = YAML.parse(
      readFileSync(new URL("../../../fixtures/evals/medium.yaml", import.meta.url), "utf8"),
    );
    const e = hashEmbedder(256);
    await buildVectorCache(nb, index, e, { fs: nodeFs, random: fixedRandom(6) });
    const r = await runEvalSet(nb, index, set, { provider: e, fs: nodeFs });
    expect(r.overall).toMatchObject({ budgetOk: 1, deterministic: 1, violations: 0 });
  });
});
