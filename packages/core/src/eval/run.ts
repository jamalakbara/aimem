import { type Briefing, buildBriefing } from "../context/briefing.js";
import { buildQuery } from "../context/score.js";
import type { EmbeddingProvider } from "../embed/provider.js";
import { semanticForQuery } from "../embed/semantic.js";
import type { NotebookIndex } from "../index/build.js";
import type { Fs } from "../ports.js";
import type { Notebook } from "../project/load.js";
import { freshnessOf } from "../validate/validate.js";

/** One eval case (12 §3). Field names follow the YAML file. */
export interface EvalCase {
  id: string;
  category: string;
  task?: string;
  ref?: string;
  paths?: string[];
  role?: string;
  must_include: string[];
  must_not_include?: string[];
  max_tokens?: number;
  include_superseded?: boolean;
}

export interface EvalSet {
  project: string;
  /** Evaluation time (freshness depends on it). */
  clock: string;
  /** Cut-off for recall@k. */
  k: number;
  cases: EvalCase[];
}

export interface CaseResult {
  id: string;
  category: string;
  /** Share of must_include in the top k by score; null when the case has no must_include. */
  recall: number | null;
  /** Share of must_include shown in a briefing section (not just "More"). */
  inBriefing: number | null;
  missing: string[];
  /** must_not_include records that appeared anywhere in the briefing. */
  violations: string[];
  budgetOk: boolean;
  deterministic: boolean;
  /** Inferred or stale records shown without a warning. */
  unlabelled: string[];
}

export interface Summary {
  n: number;
  recall: number;
  inBriefing: number;
  violations: number;
}

export interface EvalReport {
  cases: CaseResult[];
  byCategory: Record<string, Summary>;
  overall: Summary & { budgetOk: number; deterministic: number };
}

const round = (n: number) => Math.round(n * 10000) / 10000;
const mean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? round(v.reduce((a, b) => a + b, 0) / v.length) : 0;
};

function shownRefs(b: Briefing): string[] {
  return [
    ...(b.handoff ? [b.handoff.ref] : []),
    ...(b.task ? [b.task.ref] : []),
    ...b.decisions,
    ...b.memories,
    ...b.other,
  ].map((x) => (typeof x === "string" ? x : x.ref));
}

/** Run every case through `buildBriefing` and compute the 12 §3 metrics. Pure. */
export async function runEvalSet(
  nb: Notebook,
  index: NotebookIndex,
  set: EvalSet,
  semantic?: { provider: EmbeddingProvider; fs: Fs },
): Promise<EvalReport> {
  const now = new Date(set.clock);
  const byId = new Map(index.records.map((r) => [r.id, r]));
  const cases: CaseResult[] = [];
  for (const c of set.cases) {
    const input = {
      ...(c.task ? { task: c.task } : {}),
      ...(c.ref ? { ref: c.ref } : {}),
      ...(c.paths ? { paths: c.paths } : {}),
      ...(c.role ? { role: c.role } : {}),
      ...(c.max_tokens ? { budget: c.max_tokens } : {}),
      ...(c.include_superseded ? { includeSuperseded: true } : {}),
    };
    if (semantic) {
      const s = await semanticForQuery(nb, index, semantic.provider, buildQuery(nb, index, input), {
        fs: semantic.fs,
      });
      if ("scores" in s) Object.assign(input, { semantic: s });
    }
    const b = buildBriefing(nb, index, input, now);
    const again = buildBriefing(nb, index, input, now);
    const top = new Set(b.explain.slice(0, set.k).map((e) => e.ref));
    const shown = new Set(shownRefs(b));
    const anywhere = new Set([...shown, ...b.more.map((m) => m.ref)]);
    const must = c.must_include;
    const unlabelled = [...shown].filter((ref) => {
      const r = byId.get(ref);
      if (!r) return false;
      const flagged =
        r.trust === "inferred" ||
        freshnessOf({ ...r.fm, type: r.type, created: r.created }, nb.config, now) !== "fresh";
      return flagged && !b.warnings.some((w) => w.startsWith(`${ref} `) || w.includes(` ${ref} `));
    });
    cases.push({
      id: c.id,
      category: c.category,
      recall: must.length ? round(must.filter((m) => top.has(m)).length / must.length) : null,
      inBriefing: must.length ? round(must.filter((m) => shown.has(m)).length / must.length) : null,
      missing: must.filter((m) => !top.has(m)),
      violations: (c.must_not_include ?? []).filter((m) => anywhere.has(m)),
      budgetOk: b.header.used <= b.header.budget,
      deterministic: again.markdown === b.markdown,
      unlabelled,
    });
  }
  const summarize = (cs: CaseResult[]): Summary => ({
    n: cs.length,
    recall: mean(cs.map((c) => c.recall)),
    inBriefing: mean(cs.map((c) => c.inBriefing)),
    violations: cs.reduce((a, c) => a + c.violations.length, 0),
  });
  const byCategory: Record<string, Summary> = {};
  for (const cat of [...new Set(cases.map((c) => c.category))].sort())
    byCategory[cat] = summarize(cases.filter((c) => c.category === cat));
  return {
    cases,
    byCategory,
    overall: {
      ...summarize(cases),
      budgetOk: round(cases.filter((c) => c.budgetOk).length / (cases.length || 1)),
      deterministic: round(cases.filter((c) => c.deterministic).length / (cases.length || 1)),
    },
  };
}
