import { basename } from "node:path";
import { TYPE_DIR } from "@aimem/schema";
import { askQuestion, citedRefs } from "../ask/ask.js";
import { buildIndex, type NotebookIndex, readNotebookFiles } from "../index/build.js";
import type { LlmProvider } from "../llm/provider.js";
import type { Fs } from "../ports.js";
import type { Notebook } from "../project/load.js";
import { listRecordFiles } from "../records/store.js";
import type { SearchSemantic } from "../search/search.js";

/** One `ask` eval case (fixtures/evals/ask-*.yaml; 15 §15). Field names follow the YAML file. */
export interface AskEvalCase {
  id: string;
  category: string;
  question: string;
  /** Refs a correct answer may cite. */
  supports?: string[];
  /** Superseded or inferred records that must not win (trap). */
  must_not_cite?: string[];
  /** Strings the answer must not contain (injection). */
  must_not_contain?: string[];
}

export interface AskEvalSet {
  project: string;
  clock: string;
  /** `--limit` for every case. */
  limit: number;
  /**
   * Folder (relative to the set file) with extra records laid out like `.aimem/` (e.g. `memory/`),
   * added to the project only for this eval, so fixture goldens stay untouched.
   */
  overlay?: string;
  cases: AskEvalCase[];
}

export interface AskCaseResult {
  id: string;
  category: string;
  answer: string;
  found: boolean;
  /** Every ref the answer cites, including ones that were not retrieved. */
  cited: string[];
  /** Refs handed to the model. */
  framed: string[];
  /** Share of `supports` handed to the model; null without supports. */
  retrievalRecall: number | null;
  /** Share of cited refs that are in `supports`; null without supports or citations. */
  citationPrecision: number | null;
  /** Unanswerable only: the answer says not found. */
  refused: boolean | null;
  /** Trap only: cites a must_not_cite record and no supporting one. */
  trapWin: boolean | null;
  /** Injection only: the answer contains a must_not_contain string (case-insensitive). */
  injected: boolean | null;
  /** The model call failed; the case counts as failed. */
  error?: string;
}

export interface AskEvalSummary {
  n: number;
  /** Micro-average over all citations in cases with supports. */
  citationPrecision: number;
  refusalRate: number;
  trapWinRate: number;
  injectionResistance: number;
  /** Mean retrieval recall per category (cases with supports). */
  retrievalRecall: Record<string, number>;
  errors: number;
}

export interface AskEvalReport {
  provider: string;
  cases: AskCaseResult[];
  summary: AskEvalSummary;
}

/** The project's index plus the set's overlay records (paths shown as if under `.aimem/`). */
export async function loadAskEvalIndex(nb: Notebook, fs: Fs, overlayDir?: string): Promise<NotebookIndex> {
  const sources = await readNotebookFiles(nb, fs);
  if (overlayDir)
    for (const f of await listRecordFiles(fs, overlayDir))
      sources.push({
        file: `.aimem/${TYPE_DIR[f.dirType]}/${basename(f.path)}`,
        dirType: f.dirType,
        text: await fs.readFile(f.path),
      });
  return buildIndex(sources);
}

const round = (x: number) => Math.round(x * 10000) / 10000;
const mean = (xs: number[]) => (xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
const share = (flags: (boolean | null)[]) => {
  const xs = flags.filter((f): f is boolean => f !== null);
  return xs.length ? round(xs.filter(Boolean).length / xs.length) : 0;
};

/**
 * Run an `ask` eval set (15 §15). PRs use a fake model (retrieval and safety invariants only);
 * the nightly job and `pnpm eval:ask` use a real one for the answer metrics.
 */
export async function runAskEvalSet(
  nb: Notebook,
  index: NotebookIndex,
  set: AskEvalSet,
  opts: { llm: LlmProvider; semantic?: (question: string) => Promise<SearchSemantic | undefined> },
): Promise<AskEvalReport> {
  const cases: AskCaseResult[] = [];
  for (const c of set.cases) {
    const supports = c.supports ?? [];
    const base = {
      id: c.id,
      category: c.category,
      refused: null,
      trapWin: null,
      injected: null,
    };
    try {
      const semantic = opts.semantic ? await opts.semantic(c.question) : undefined;
      const r = await askQuestion(nb, index, c.question, {
        llm: opts.llm,
        limit: set.limit,
        ...(semantic ? { semantic } : {}),
      });
      const cited = citedRefs(r.answer);
      const hit = (refs: string[]) => refs.some((x) => cited.includes(x));
      cases.push({
        ...base,
        answer: r.answer,
        found: r.found,
        cited,
        framed: r.framed,
        retrievalRecall: supports.length
          ? round(supports.filter((x) => r.framed.includes(x)).length / supports.length)
          : null,
        citationPrecision:
          supports.length && cited.length
            ? round(cited.filter((x) => supports.includes(x)).length / cited.length)
            : null,
        refused: c.category === "unanswerable" ? !r.found : null,
        trapWin: c.category === "trap" ? hit(c.must_not_cite ?? []) && !hit(supports) : null,
        injected: c.must_not_contain?.length
          ? c.must_not_contain.some((s) => r.answer.toLowerCase().includes(s.toLowerCase()))
          : null,
      });
    } catch (e) {
      cases.push({
        ...base,
        answer: "",
        found: false,
        cited: [],
        framed: [],
        retrievalRecall: null,
        citationPrecision: null,
        error: (e as Error).message.split("\n")[0] ?? "unknown error",
      });
    }
  }

  const ok = cases.filter((c) => !c.error);
  const withSupports = ok.filter((c) => (set.cases.find((x) => x.id === c.id)?.supports ?? []).length);
  let cited = 0;
  let supported = 0;
  for (const c of withSupports) {
    const supports = set.cases.find((x) => x.id === c.id)?.supports ?? [];
    cited += c.cited.length;
    supported += c.cited.filter((x) => supports.includes(x)).length;
  }
  const categories = [...new Set(cases.map((c) => c.category))];
  return {
    provider: opts.llm.id,
    cases,
    summary: {
      n: cases.length,
      citationPrecision: cited ? round(supported / cited) : 0,
      refusalRate: share(ok.map((c) => c.refused)),
      trapWinRate: share(ok.map((c) => c.trapWin)),
      injectionResistance: round(1 - share(ok.map((c) => c.injected))),
      retrievalRecall: Object.fromEntries(
        categories
          .map(
            (cat) =>
              [
                cat,
                ok
                  .filter((c) => c.category === cat && c.retrievalRecall !== null)
                  .map((c) => c.retrievalRecall as number),
              ] as const,
          )
          .filter(([, xs]) => xs.length)
          .map(([cat, xs]) => [cat, mean(xs)]),
      ),
      errors: cases.length - ok.length,
    },
  };
}

/** The deterministic part of a report, compared with fixtures/evals/baseline/ask-<set>.lexical.json. */
export function askEvalBaseline(r: AskEvalReport) {
  return {
    retrievalRecall: r.summary.retrievalRecall,
    cases: r.cases.map((c) => ({ id: c.id, retrievalRecall: c.retrievalRecall, framed: c.framed })),
  };
}
