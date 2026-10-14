import { TRUST_WEIGHT, type Trust } from "@aimem/schema";
import { AimemError } from "../errors.js";
import type { IndexedRecord, NotebookIndex } from "../index/build.js";
import type { Notebook } from "../project/load.js";
import { bm25 } from "../search/bm25.js";
import { FIELD_BOOSTS, HIDDEN_STATUSES } from "../search/search.js";
import { matchGlob, staticPrefix } from "../util/glob.js";
import { normaliseSemantic } from "../util/normalise.js";
import { type Freshness, freshnessOf } from "../validate/validate.js";

/** Semantic scores for one query, computed ahead of time (embedding is async; scoring is pure). */
export interface SemanticInput {
  /** Record id → best-chunk similarity, 0..1. */
  scores: ReadonlyMap<string, number>;
  /** Provider id, shown in the briefing header. */
  provider: string;
  /** Share of eligible records that have vectors, 0..1. */
  coverage: number;
}

export type Fusion = "weighted" | "rrf";

export interface ContextInput {
  task?: string;
  /** Task ref this session works on. */
  ref?: string;
  /** Touched or provided files/globs. */
  paths?: string[];
  role?: string;
  budget?: number;
  includeSuperseded?: boolean;
  /** Current git branch; its words join the query. */
  branch?: string;
  /** Semantic scores; without them retrieval is lexical-only (15 §6). */
  semantic?: SemanticInput;
  /** Why semantic search is off, for the header. */
  semanticOff?: string;
  /** Lexical/semantic fusion (default from `retrieval.fusion`, else weighted). */
  fusion?: Fusion;
}

/** Components are 0..1; `total` = weighted sum × trust × freshness (06 §2 step 5, 15 §6). */
export interface ScoreParts {
  lexical: number;
  semantic: number;
  paths: number;
  links: number;
  recency: number;
  typeBoost: number;
  roleMatch: number;
  trust: number;
  freshness: number;
  total: number;
}

export type Pin = "task" | "handoff" | "pinned";

export interface Candidate {
  record: IndexedRecord;
  parts: ScoreParts;
  pin?: Pin;
}

/** 15 §6: without embeddings the semantic weight (0.25) moves to lexical. */
export const WEIGHTS = {
  lexical: 0.5,
  paths: 0.2,
  links: 0.1,
  recency: 0.1,
  typeBoost: 0.05,
  roleMatch: 0.05,
};
/** 15 §6 with embeddings. */
export const HYBRID_WEIGHTS = { ...WEIGHTS, lexical: 0.25, semantic: 0.25 };
/** Semantic-only candidates admitted per query (15 §6: vector top-N). */
export const SEMANTIC_TOP_N = 50;
const RRF_K = 60;
const FRESHNESS_WEIGHT: Record<Freshness, number> = { fresh: 1, stale: 0.6, expired: 0.3 };
const DAY = 86_400_000;
const round = (n: number) => Math.round(n * 10000) / 10000;
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const IGNORED_BRANCHES = new Set(["main", "master", "develop", "dev", "trunk", "head"]);
const byScoreThenId = (m: ReadonlyMap<string, number>) => (a: string, b: string) =>
  (m.get(b) ?? 0) - (m.get(a) ?? 0) || (a < b ? -1 : 1);

function localId(ref: string, project: string): string | undefined {
  const i = ref.indexOf(":");
  if (i < 0) return ref;
  return ref.slice(0, i) === project ? ref.slice(i + 1) : undefined;
}

/** Outgoing references of a record (links, blockers, supersede, handoff task, testcase covers). */
function refsOf(r: IndexedRecord, project: string): string[] {
  return [
    ...r.links,
    ...strs(r.fm.blocked_by),
    ...strs(r.fm.covers),
    ...[str(r.fm.supersedes), str(r.fm.superseded_by), str(r.fm.task)].filter((x): x is string => !!x),
  ]
    .map((x) => localId(x, project))
    .filter((x): x is string => !!x);
}

function pathScore(globs: string[], wanted: string[]): number {
  if (!globs.length || !wanted.length) return 0;
  if (globs.some((g) => wanted.some((w) => g === w || matchGlob(g, w) || matchGlob(w, g)))) return 1;
  const near = globs.some((g) =>
    wanted.some((w) => {
      const a = staticPrefix(g).replace(/[^/]*$/, "");
      const b = w.replace(/[^/]*$/, "");
      return a.length > 0 && b.length > 0 && (a.startsWith(b) || b.startsWith(a));
    }),
  );
  return near ? 0.5 : 0;
}

/** Section of the task body used for the query and the briefing: Goal + Acceptance criteria, else the body. */
export function taskEssentials(body: string): string {
  const pick = (name: string) =>
    new RegExp(`^##\\s+${name}\\s*\\n([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))`, "m").exec(body)?.[0]?.trim();
  const parts = [pick("Goal"), pick("Acceptance criteria")].filter(Boolean);
  return parts.length ? parts.join("\n\n") : body;
}

export function branchWords(branch?: string): string {
  if (!branch || IGNORED_BRANCHES.has(branch.toLowerCase())) return "";
  return branch
    .split(/[/_.-]+/)
    .filter((w) => w && !/^(feat|fix|chore|docs|refactor|test|ci|build|perf)$/i.test(w))
    .join(" ");
}

interface Prepared {
  byId: Map<string, IndexedRecord>;
  pool: IndexedRecord[];
  refTask?: IndexedRecord;
  pathParts: Map<string, number>;
  query: string;
}

/** Steps 3–4: resolve the ref task, apply hard filters, build the query (06 §2, 15 §7). */
function prepare(nb: Notebook, index: NotebookIndex, input: ContextInput): Prepared {
  const project = nb.config.project;
  const byId = new Map<string, IndexedRecord>();
  for (const r of index.records) if (!byId.has(r.id)) byId.set(r.id, r);
  let refTask: IndexedRecord | undefined;
  if (input.ref) {
    const id = localId(input.ref, project);
    refTask = id ? byId.get(id) : undefined;
    if (!refTask) throw new AimemError("NOT_FOUND", `task ${input.ref} not found`);
    if (refTask.type !== "task")
      throw new AimemError("INVALID_RECORD", `${input.ref} is a ${refTask.type}, not a task`);
  }
  const repo = nb.config.repo;
  const pool = index.records.filter(
    (r) =>
      (input.includeSuperseded || !HIDDEN_STATUSES.has(r.status) || r.id === refTask?.id) &&
      (!repo || !r.repo || r.repo === repo || r.repo === "all"),
  );
  const wanted = input.paths ?? [];
  const pathParts = new Map(pool.map((r) => [r.id, pathScore(r.paths, wanted)]));
  const pathTags = pool
    .filter((r) => (pathParts.get(r.id) ?? 0) > 0)
    .flatMap((r) => r.tags.filter((t) => t !== "pinned"));
  const query = [
    input.task ?? "",
    branchWords(input.branch),
    refTask ? `${refTask.title} ${refTask.summary} ${taskEssentials(refTask.body)}` : "",
    ...new Set(pathTags),
  ]
    .join(" ")
    .trim();
  return { byId, pool, ...(refTask ? { refTask } : {}), pathParts, query };
}

/** The retrieval query for a context request (15 §7); embed it as a *query* for semantic scores. */
export function buildQuery(nb: Notebook, index: NotebookIndex, input: ContextInput): string {
  return prepare(nb, index, input).query;
}

/** Score every eligible record (06 §2 steps 3–6, 15 §6, §8). */
export function scoreCandidates(
  nb: Notebook,
  index: NotebookIndex,
  input: ContextInput,
  now: Date,
): { candidates: Candidate[]; refTask?: IndexedRecord; fusion: Fusion } {
  const project = nb.config.project;
  const { byId, pool, refTask, pathParts, query } = prepare(nb, index, input);
  const inPool = new Set(pool.map((r) => r.id));
  const fusion: Fusion = input.fusion ?? (nb.config.retrieval?.fusion === "rrf" ? "rrf" : "weighted");
  const semantic = input.semantic;

  const raw = bm25(
    pool.map((r) => ({
      id: r.id,
      fields: { title: r.title, summary: r.summary, tags: r.tags.join(" "), body: r.body },
    })),
    query,
    FIELD_BOOSTS,
  );
  const maxRaw = Math.max(0, ...raw.values());
  const lexical = (r: IndexedRecord) => (maxRaw > 0 ? (raw.get(r.id) ?? 0) / maxRaw : 0);
  // Hard filters first: only pool records can carry a semantic score (15 §6).
  const semScore = semantic
    ? normaliseSemantic(
        semantic.scores,
        pool.map((r) => r.id),
      )
    : new Map<string, number>();
  const semanticTop = new Set(
    [...semScore.keys()]
      .filter((id) => (semScore.get(id) ?? 0) > 0)
      .sort(byScoreThenId(semScore))
      .slice(0, SEMANTIC_TOP_N),
  );

  // Reciprocal rank fusion of the lexical and semantic rankings, normalised to 0..1.
  const rrf = new Map<string, number>();
  if (semantic && fusion === "rrf") {
    const lexMap = new Map(pool.map((r) => [r.id, lexical(r)]));
    for (const [m, ids] of [
      [lexMap, pool.map((r) => r.id).filter((id) => (lexMap.get(id) ?? 0) > 0)],
      [semScore, [...semanticTop]],
    ] as const) {
      [...ids].sort(byScoreThenId(m)).forEach((id, rank) => {
        rrf.set(id, (rrf.get(id) ?? 0) + 1 / (RRF_K + rank + 1));
      });
    }
    const max = Math.max(0, ...rrf.values());
    if (max > 0) for (const [id, v] of rrf) rrf.set(id, v / max);
  }

  // Links (15 §8): a link to a superseded record counts for the head of its supersede chain.
  const head = (id: string): string => {
    let cur = id;
    for (let i = 0; i < 10; i++) {
      const next = localId(str(byId.get(cur)?.fm.superseded_by) ?? "", project);
      if (!next || !byId.has(next) || inPool.has(cur)) break;
      cur = next;
    }
    return cur;
  };
  const neighbours = new Map<string, Set<string>>();
  const connect = (a: string, b: string) => {
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    neighbours.get(a)?.add(b);
  };
  for (const r of index.records) {
    for (const t of refsOf(r, project)) {
      if (!byId.has(t)) continue;
      connect(r.id, t);
      connect(t, r.id);
    }
  }
  const prelim = (r: IndexedRecord) =>
    (semantic
      ? HYBRID_WEIGHTS.lexical * lexical(r) + HYBRID_WEIGHTS.semantic * (semScore.get(r.id) ?? 0)
      : WEIGHTS.lexical * lexical(r)) +
    WEIGHTS.paths * (pathParts.get(r.id) ?? 0);
  const seeds = refTask
    ? [refTask.id]
    : pool
        .filter((r) => prelim(r) > 0)
        .sort((a, b) => prelim(b) - prelim(a) || (a.id < b.id ? -1 : 1))
        .slice(0, 5)
        .map((r) => r.id);
  const linkScore = new Map<string, number>();
  const award = (id: string, score: number) => {
    const target = head(id);
    if (!seeds.includes(target) && (linkScore.get(target) ?? 0) < score) linkScore.set(target, score);
  };
  for (const s of seeds) {
    for (const n of neighbours.get(s) ?? []) {
      award(n, 1);
      for (const m of neighbours.get(n) ?? []) if (m !== s) award(m, 0.5);
    }
  }

  // Pins (step 6).
  const handoffs = pool
    .filter(
      (r) => r.type === "handoff" && (!refTask || localId(str(r.fm.task) ?? "", project) === refTask.id),
    )
    .sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : a.id < b.id ? -1 : 1));
  const pinnedHandoff = handoffs[0];
  const pinOf = (r: IndexedRecord): Pin | undefined =>
    r.id === refTask?.id
      ? "task"
      : r.id === pinnedHandoff?.id
        ? "handoff"
        : r.tags.includes("pinned") && !HIDDEN_STATUSES.has(r.status)
          ? "pinned"
          : undefined;

  const candidates: Candidate[] = [];
  for (const r of pool) {
    const pin = pinOf(r);
    const lex = lexical(r);
    const sem = semanticTop.has(r.id) ? (semScore.get(r.id) ?? 0) : 0;
    const paths = pathParts.get(r.id) ?? 0;
    const links = linkScore.get(r.id) ?? 0;
    if (!pin && lex === 0 && sem === 0 && paths === 0 && links === 0) continue;
    const ageDays = Math.max(0, (now.getTime() - Date.parse(r.updated)) / DAY);
    const recency = 0.5 ** (ageDays / (r.type === "handoff" ? 7 : 30));
    const typeBoost =
      r.id === refTask?.id
        ? 1
        : r.id === pinnedHandoff?.id
          ? 0.9
          : r.type === "decision" && r.status === "accepted"
            ? 0.6
            : r.type === "memory" && r.status === "active"
              ? 0.5
              : 0.3;
    const roleMatch = !input.role || r.roles.includes("all") || r.roles.includes(input.role) ? 1 : 0;
    const trust = TRUST_WEIGHT[r.trust as Trust] ?? 0.4;
    const freshness =
      FRESHNESS_WEIGHT[freshnessOf({ ...r.fm, type: r.type, created: r.created }, nb.config, now)];
    const text = !semantic
      ? WEIGHTS.lexical * lex
      : fusion === "rrf"
        ? (HYBRID_WEIGHTS.lexical + HYBRID_WEIGHTS.semantic) * (rrf.get(r.id) ?? 0)
        : HYBRID_WEIGHTS.lexical * lex + HYBRID_WEIGHTS.semantic * sem;
    const weighted =
      text +
      WEIGHTS.paths * paths +
      WEIGHTS.links * links +
      WEIGHTS.recency * recency +
      WEIGHTS.typeBoost * typeBoost +
      WEIGHTS.roleMatch * roleMatch;
    candidates.push({
      record: r,
      ...(pin ? { pin } : {}),
      parts: {
        lexical: round(lex),
        semantic: round(sem),
        paths,
        links,
        recency: round(recency),
        typeBoost,
        roleMatch,
        trust,
        freshness,
        total: round(weighted * trust * freshness),
      },
    });
  }
  candidates.sort((a, b) => b.parts.total - a.parts.total || (a.record.id < b.record.id ? -1 : 1));
  return { candidates, ...(refTask ? { refTask } : {}), fusion };
}
