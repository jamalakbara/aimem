import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type EvalSet, loadIndex, loadProject, nodeFs, runEvalSet } from "@aimem/core";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { FIXTURES } from "./helpers.js";

const EVALS = fileURLToPath(new URL("../../../fixtures/evals/", import.meta.url));

async function project(name: string) {
  const nb = await loadProject(nodeFs, join(FIXTURES, name));
  return { nb, index: await loadIndex(nb, { fs: nodeFs }) };
}

describe("runEvalSet (12 §3)", () => {
  it("computes recall, briefing presence, violations, budget, determinism and labels per case", async () => {
    const { nb, index } = await project("tiny");
    const set: EvalSet = {
      project: "tiny",
      clock: "2026-10-12T00:00:00Z",
      k: 10,
      cases: [
        {
          id: "hit",
          category: "keyword",
          task: "integer minor units money",
          must_include: ["dec-1a2b3c4d", "tsk-zzzzzzzz"],
        },
        {
          id: "violation",
          category: "trap",
          task: "floating point amounts",
          must_include: [],
          must_not_include: ["dec-2b3c4d5e"],
          include_superseded: true,
        },
        { id: "budget", category: "keyword", task: "money", must_include: ["dec-1a2b3c4d"], max_tokens: 300 },
      ],
    };
    const r = await runEvalSet(nb, index, set);
    const byId = Object.fromEntries(r.cases.map((c) => [c.id, c]));
    expect(byId.hit).toMatchObject({
      recall: 0.5,
      missing: ["tsk-zzzzzzzz"],
      violations: [],
      budgetOk: true,
      deterministic: true,
      unlabelled: [],
    });
    expect(byId.violation?.violations).toEqual(["dec-2b3c4d5e"]);
    expect(byId.budget?.budgetOk).toBe(true);
    expect(r.byCategory.keyword?.n).toBe(2);
    expect(r.overall.violations).toBe(1);
  });

  it("flags inferred or stale records shown without a warning label", async () => {
    const { nb, index } = await project("medium");
    const r = await runEvalSet(nb, index, {
      project: "medium",
      clock: "2026-10-12T00:00:00Z",
      k: 10,
      cases: [{ id: "x", category: "trap", task: "eslint prettier lint", must_include: [] }],
    });
    expect(r.cases[0]?.unlabelled).toEqual([]);
  });
});

describe("medium eval set: gates (docs/12 §3) and baseline", () => {
  const set = YAML.parse(readFileSync(join(EVALS, "medium.yaml"), "utf8")) as EvalSet;
  const baseline = JSON.parse(readFileSync(join(EVALS, "baseline/medium.lexical.json"), "utf8"));

  it("has the planned shape", () => {
    expect(set.cases.length).toBeGreaterThanOrEqual(20);
    expect(new Set(set.cases.map((c) => c.category))).toEqual(
      new Set(["keyword", "paraphrase", "multilingual", "trap"]),
    );
    expect(new Set(set.cases.map((c) => c.id)).size).toBe(set.cases.length);
  });

  it("gates: keyword recall@10 ≥ 0.85, no violations, budget 100%, deterministic, labelled", async () => {
    const { nb, index } = await project("medium");
    const r = await runEvalSet(nb, index, set);
    expect(r.byCategory.keyword?.recall).toBeGreaterThanOrEqual(0.85);
    expect(r.overall.violations).toBe(0);
    expect(r.overall.budgetOk).toBe(1);
    expect(r.overall.deterministic).toBe(1);
    expect(r.cases.flatMap((c) => c.unlabelled)).toEqual([]);
  });

  it("matches the committed baseline (update it deliberately with `pnpm eval --update-baseline` and report the deltas)", async () => {
    const { nb, index } = await project("medium");
    const r = await runEvalSet(nb, index, set);
    expect({
      byCategory: r.byCategory,
      overall: r.overall,
      cases: r.cases.map((c) => ({ id: c.id, recall: c.recall, inBriefing: c.inBriefing })),
    }).toEqual(baseline);
  });
});
