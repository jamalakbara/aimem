import { RECORD_TYPES } from "@aimem/schema";
import type { IndexedRecord, NotebookIndex } from "../index/build.js";
import type { Notebook } from "../project/load.js";
import { HIDDEN_STATUSES } from "../search/search.js";
import { freshnessOf, RETIRED_STATUSES } from "../validate/validate.js";

const meta = (r: IndexedRecord) => ({
  ref: r.id,
  type: r.type,
  status: r.status,
  trust: r.trust,
  title: r.title,
  file: r.file,
});
const byId = (a: IndexedRecord, b: IndexedRecord) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** `aimem status` (04 §3): counts, urgent tasks, stale items, unreviewed records, latest handoff. */
export function summarizeNotebook(nb: Notebook, index: NotebookIndex, now: Date) {
  const recs = index.records;
  const counts: Record<string, Record<string, number>> = {};
  for (const t of RECORD_TYPES) {
    const of = recs.filter((r) => r.type === t);
    if (!of.length) continue;
    counts[t] = {};
    for (const r of of) counts[t][r.status] = (counts[t][r.status] ?? 0) + 1;
  }
  const urgentTasks = recs
    .filter(
      (r) =>
        r.type === "task" &&
        (r.fm.priority === "p0" || r.fm.priority === "p1") &&
        !HIDDEN_STATUSES.has(r.status),
    )
    .sort((a, b) => String(a.fm.priority).localeCompare(String(b.fm.priority)) || byId(a, b))
    .map((r) => ({ ...meta(r), priority: String(r.fm.priority) }));
  const stale = recs
    .filter(
      (r) =>
        !RETIRED_STATUSES.has(r.status) &&
        freshnessOf({ ...r.fm, type: r.type, created: r.created }, nb.config, now) !== "fresh",
    )
    .map(meta);
  const current = recs.filter((r) => !HIDDEN_STATUSES.has(r.status) && !RETIRED_STATUSES.has(r.status));
  const handoffs = recs
    .filter((r) => r.type === "handoff")
    .sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : byId(a, b)));
  const last = handoffs[0];
  return {
    project: nb.config.project,
    mode: nb.config.mode,
    sync: nb.config.sync,
    total: recs.length,
    counts,
    urgentTasks,
    stale,
    unreviewed: {
      agent: current.filter((r) => r.trust === "agent").length,
      inferred: current.filter((r) => r.trust === "inferred").length,
    },
    problems: index.problems.length,
    lastHandoff: last
      ? { ref: last.id, created: last.created, author: last.author, summary: last.summary }
      : null,
    claims: "live claims arrive in M3",
  };
}

export type NotebookSummary = ReturnType<typeof summarizeNotebook>;
