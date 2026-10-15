import { TRUST_WEIGHT, type Trust } from "@aimem/schema";
import { AimemError } from "../errors.js";
import type { IndexedRecord, NotebookIndex } from "../index/build.js";
import type { Notebook } from "../project/load.js";
import { bm25 } from "../search/bm25.js";
import { FIELD_BOOSTS, HIDDEN_STATUSES } from "../search/search.js";
import { matchGlob, staticPrefix } from "../util/glob.js";
import { type Freshness, freshnessOf } from "../validate/validate.js";

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
}

/** Components are 0..1; `total` = weighted sum × trust × freshness (06 §2 step 5, lexical-only weights). */
export interface ScoreParts {
  lexical: number;
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
const FRESHNESS_WEIGHT: Record<Freshness, number> = { fresh: 1, stale: 0.6, expired: 0.3 };
const DAY = 86_400_000;
const round = (n: number) => Math.round(n * 10000) / 10000;
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const IGNORED_BRANCHES = new Set(["main", "master", "develop", "dev", "trunk", "head"]);

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

/** Score every eligible record (06 §2 steps 3–6). */
export function scoreCandidates(
  nb: Notebook,
  index: NotebookIndex,
  input: ContextInput,
  now: Date,
): { candidates: Candidate[]; refTask?: IndexedRecord } {
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

  // Step 3: filter.
  const repo = nb.config.repo;
  const pool = index.records.filter(
    (r) =>
      (input.includeSuperseded || !HIDDEN_STATUSES.has(r.status) || r.id === refTask?.id) &&
      (!repo || !r.repo || r.repo === repo || r.repo === "all"),
  );

  // Step 4: query = task text + branch words + ref task + tags of records covering touched paths.
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

  // Links: seeds are the ref task, or the top preliminary hits; neighbours 1.0, two hops 0.5 (undirected).
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
    WEIGHTS.lexical * lexical(r) + WEIGHTS.paths * (pathParts.get(r.id) ?? 0);
  const seeds = refTask
    ? [refTask.id]
    : pool
        .filter((r) => prelim(r) > 0)
        .sort((a, b) => prelim(b) - prelim(a) || (a.id < b.id ? -1 : 1))
        .slice(0, 5)
        .map((r) => r.id);
  const linkScore = new Map<string, number>();
  for (const s of seeds) {
    for (const n of neighbours.get(s) ?? []) {
      if (!seeds.includes(n)) linkScore.set(n, 1);
      for (const m of neighbours.get(n) ?? [])
        if (!seeds.includes(m) && (linkScore.get(m) ?? 0) < 0.5) linkScore.set(m, 0.5);
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
    const paths = pathParts.get(r.id) ?? 0;
    const links = linkScore.get(r.id) ?? 0;
    if (!pin && lex === 0 && paths === 0 && links === 0) continue;
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
    const weighted =
      WEIGHTS.lexical * lex +
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
  return { candidates, ...(refTask ? { refTask } : {}) };
}
