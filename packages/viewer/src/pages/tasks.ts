import type { IndexedRecord } from "@aimem/core";
import { DEFAULT_PRIORITY, STATUSES } from "@aimem/schema";
import { type Html, html } from "../html.js";
import { PAGE_SIZE, readChoice, readPage } from "../query.js";
import { columnLabel, dateLabel, T, tasksHeading, viewAllTasks } from "../strings.js";
import { type Page, sectionHref, shown, type ViewContext } from "../view.js";
import { anchors, byRecord, byUpdated, type Chip, card, chips, compare, idCounts, pager } from "./cards.js";
import { notebookPage } from "./layout.js";

/** Cards of one column on the board; the list of that status has the rest (24 §5.4). */
export const BOARD_CAP = 10;

/** A status that is not in the schema. The index keeps such records (`validate` reports them), so the board shows them. */
const OTHER = "other";
const COLUMNS: readonly string[] = [...STATUSES.task, OTHER];
const KNOWN: ReadonlySet<string> = new Set(STATUSES.task);
/** Finished work: what changed last matters more than how urgent it was. */
const CLOSED: ReadonlySet<string> = new Set(["done", "cancelled"]);
const PRIORITIES = ["p0", "p1", "p2", "p3"];

const statusOf = (r: IndexedRecord): string => (KNOWN.has(r.status) ? r.status : OTHER);
/** The priority written in the record, when it is one. */
const written = (r: IndexedRecord): string | undefined =>
  typeof r.fm.priority === "string" && PRIORITIES.includes(r.fm.priority) ? r.fm.priority : undefined;
/** A task without priority counts as the default (03 §3.2); something that is not a priority comes last. */
const rank = (r: IndexedRecord): number => {
  if (r.fm.priority === undefined || r.fm.priority === null) return PRIORITIES.indexOf(DEFAULT_PRIORITY);
  const i = written(r) === undefined ? -1 : PRIORITIES.indexOf(written(r) ?? "");
  return i < 0 ? PRIORITIES.length : i;
};
const byPriority = (a: IndexedRecord, b: IndexedRecord): number =>
  rank(a) - rank(b) || compare(b.updated, a.updated) || byRecord(a, b);

const text = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

export function taskCard(
  c: ViewContext,
  r: IndexedRecord,
  o: { level: 2 | 3; anchor: string; shared: boolean; summary: boolean },
): Html {
  const priority = written(r);
  const assignee = text(r.fm.assignee);
  const due = text(r.fm.due);
  const blocked = Array.isArray(r.fm.blocked_by) ? r.fm.blocked_by.length : 0;
  return card(c, r, {
    level: o.level,
    anchor: o.anchor,
    shared: o.shared,
    summary: o.summary,
    // The column or the heading of the list says the type and the status; a status that is not in the schema is said here.
    type: false,
    status: statusOf(r) === OTHER,
    lead:
      priority &&
      html`<span class="badge"><span class="sr">${T.priority} </span>${priority.toUpperCase()}</span> `,
    meta: html`<p class="meta">${dateLabel(r.created)}${assignee && html` · ${assignee}`}${due && html` · ${T.due(dateLabel(due))}`}${blocked > 0 && html` · ${T.blockedBy(blocked)}`}</p>
`,
  });
}

/** The tasks of the notebook (or of the lens) by status, each column in its order. */
export function groups(c: ViewContext): Map<string, IndexedRecord[]> {
  const by = new Map<string, IndexedRecord[]>(COLUMNS.map((s) => [s, []]));
  for (const r of shown(c)) if (r.type === "task") by.get(statusOf(r))?.push(r);
  for (const [s, list] of by) list.sort(CLOSED.has(s) ? byUpdated : byPriority);
  return by;
}

/** Task board: a column per status of the schema, or the list of one status (24 §5.4). */
export function tasksPage(c: ViewContext, params: URLSearchParams): Page {
  const { project } = c.nb.config;
  const by = groups(c);
  const total = [...by.values()].reduce((n, l) => n + l.length, 0);
  const { value: status, unknown } = readChoice(params, "status", COLUMNS);
  const note = (unknown || c.lensIgnored) && html`<p class="note">${T.filterIgnored}</p>`;
  const href = (s?: string, page?: number) =>
    sectionHref(project, "tasks", { status: s, page, lens: c.lens });
  const nav: Chip[] = [
    { text: T.withCount(T.any, total), href: href(), current: status === undefined },
    ...COLUMNS.filter((s) => s !== OTHER || (by.get(s)?.length ?? 0) > 0).map((s) => ({
      text: T.withCount(columnLabel(s), by.get(s)?.length ?? 0),
      href: href(s),
      current: status === s,
    })),
  ];
  const heading = tasksHeading(status ?? "");
  const shell = (title: string, body: Html, wide = false) => ({
    status: 200,
    html: notebookPage(c, title, body, "", {
      current: "tasks",
      wide,
      lensOff: sectionHref(project, "tasks", { status }),
    }),
  });
  if (total === 0)
    return shell(heading, html`<h1>${heading}</h1>${note}<div class="empty"><p>${T.noTasks}</p></div>`);

  if (status !== undefined) {
    const list = by.get(status) ?? [];
    const n = list.length;
    const last = Math.max(1, Math.ceil(n / PAGE_SIZE));
    const page = Math.min(readPage(params), last);
    const title = page > 1 ? `${T.titled(heading, n)}, ${T.page(page)}` : T.titled(heading, n);
    if (!n)
      return shell(
        title,
        html`<h1>${heading}</h1>${note}${chips(T.status, nav)}<div class="empty"><h2>${T.noMatch}</h2><p><a class="button" href="${href()}">${T.clearFilters}</a></p></div>`,
      );
    const count = idCounts(c.index.records);
    const anchor = anchors();
    const from = (page - 1) * PAGE_SIZE;
    const shown = list.slice(from, from + PAGE_SIZE);
    const items = shown.map((r) =>
      taskCard(c, r, { level: 2, anchor: anchor(r.id), shared: (count.get(r.id) ?? 0) > 1, summary: true }),
    );
    return shell(
      title,
      html`<h1>${heading}</h1>${note}${chips(T.status, nav)}${last > 1 && html`<p class="meta">${T.showing(from + 1, from + shown.length, n)}</p>`}
<ol class="results" role="list">
${items}</ol>
${pager((p) => href(status, p), page, last)}`,
    );
  }

  const count = idCounts(c.index.records);
  const anchor = anchors();
  const columns = COLUMNS.flatMap((s) => {
    const list = by.get(s) ?? [];
    if (s === OTHER && list.length === 0) return [];
    const cards = list.slice(0, BOARD_CAP).map((r) =>
      taskCard(c, r, {
        level: 3,
        anchor: anchor(r.id),
        shared: (count.get(r.id) ?? 0) > 1,
        summary: false,
      }),
    );
    return [
      html`<section${s === OTHER && html` class="other"`} aria-labelledby="col-${s}"><h2 id="col-${s}">${columnLabel(s)} <span class="count">${list.length}</span></h2>
${
  list.length
    ? html`<ol class="cards" role="list">
${cards}</ol>`
    : html`<p class="meta">${T.noTasksInColumn}</p>`
}${
  list.length > BOARD_CAP &&
  html`<p class="meta">${T.shownOf(BOARD_CAP, list.length)}</p><p><a href="${href(s)}">${viewAllTasks(s, list.length)}</a></p>`
}</section>
`,
    ];
  });
  return shell(
    heading,
    html`<h1>${heading}</h1>${note}${chips(T.status, nav)}
<div class="board">
${columns}</div>`,
    true,
  );
}
