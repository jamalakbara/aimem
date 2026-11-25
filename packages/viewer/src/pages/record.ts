import { freshnessOf, type IndexedRecord } from "@aimem/core";
import { parseRef, REF_RE } from "@aimem/schema";
import { cut, type Html, html } from "../html.js";
import { renderMarkdown } from "../markdown.js";
import { dateLabel, FRESHNESS, statusLabel, systemLabel, T, trustLabel, typeLabel } from "../strings.js";
import { type Page, projectHref, recordHref, type ViewContext } from "../view.js";
import { notebookPage } from "./layout.js";

/** Limits for one page, over all bodies on it (24 §5.2). Both count UTF-16 units; more is plain, then cut. */
export const MAX_RENDER_CHARS = 200_000;
export const MAX_PLAIN_CHARS = 1_000_000;
/** Records shown on one page when several files carry the same id. */
export const MAX_SAME_ID = 5;

export interface RecordOptions {
  /** Show the body as plain text. */
  plain?: boolean;
  /** Replaces the Markdown renderer (tests). */
  render?: typeof renderMarkdown;
}

/** What is left of the page limits; each body takes its part. */
interface Budget {
  render: number;
  plain: number;
}

/** Records by id. Two local files can carry the same id, so each id has a list. */
export type ById = ReadonlyMap<string, readonly IndexedRecord[]>;

const text = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : typeof v === "number" ? String(v) : undefined;
const list = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap((x) => text(x) ?? []) : []);
const isMap = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Type-specific fields (03 §3), shown in this order when present. */
const EXTRA: readonly (readonly [key: string, label: string])[] = [
  ["priority", "Priority"],
  ["assignee", "Assignee"],
  ["due", "Due"],
  ["decided_by", "Decided by"],
  ["severity", "Severity"],
  ["started", "Started"],
  ["resolved_at", "Resolved"],
  ["services", "Services"],
  ["root_cause_category", "Root cause"],
  ["owner", "Owner"],
  ["last_tested", "Last tested"],
  ["datastore", "Data store"],
  ["objects", "Objects"],
  ["automation", "Automation"],
  ["kind", "Kind"],
  ["branch", "Branch"],
];

/** A reference as a link to the record, with how far it can be trusted; as text when this notebook does not have it. */
export function refLink(c: ViewContext, ref: string, byId: ById): Html {
  const { project } = c.nb.config;
  const { project: other, id } = parseRef(ref);
  const target = other === undefined || other === project ? byId.get(id)?.[0] : undefined;
  if (!target) return html`${ref} (${T.notHere})`;
  return html`<a href="${recordHref(project, target.id)}">${target.title}</a> <span class="meta">${target.id} · ${trustLabel(target.trust)}</span>`;
}

function details(c: ViewContext, r: IndexedRecord, byId: ById): Html {
  const rows: Html[] = [];
  const row = (label: string, value: Html[]) => {
    if (value.length) rows.push(html`<div><dt>${label}</dt><dd>${value}</dd></div>\n`);
  };
  const add = (label: string, values: readonly (string | undefined)[]) =>
    row(
      label,
      values.flatMap((v) => (v ? [html`<span class="value">${v}</span> `] : [])),
    );
  const date = (v: unknown) => {
    const s = text(v);
    return [s === undefined ? undefined : dateLabel(s)];
  };
  const refs = (label: string, values: readonly string[]) =>
    row(
      label,
      values.map((v) => html`<div>${refLink(c, v, byId)}</div>`),
    );
  const one = (v: unknown) => (text(v) ? [String(v)] : []);
  add("Reference", [r.id]);
  add("Author", [r.author]);
  add("Created", date(r.created));
  add("Updated", date(r.updated));
  for (const [key, label] of EXTRA) add(label, Array.isArray(r.fm[key]) ? list(r.fm[key]) : date(r.fm[key]));
  add("Roles", r.roles);
  add("Tags", r.tags);
  add("Repo", [r.repo]);
  add("Notebook", [r.notebook]);
  add("Paths", r.paths);
  add("Evidence", list(r.fm.evidence));
  if (r.fm.managed_by === "external" && isMap(r.fm.source)) {
    const s = r.fm.source;
    add("Last synced", date(s.synced_at));
    if (text(s.state) && s.state !== "ok") add("Source state", [T.sourceGone]);
  }
  refs("Replaces", one(r.fm.supersedes));
  refs("Replaced by", one(r.fm.superseded_by));
  refs("Task", one(r.fm.task));
  refs("Blocked by", list(r.fm.blocked_by));
  refs("Covers", list(r.fm.covers));
  refs(T.links, r.links);
  add("File", [r.file]);
  return html`<dl class="details">${rows}</dl>`;
}

function bodyOf(
  c: ViewContext,
  r: IndexedRecord,
  byId: ById,
  o: RecordOptions,
  level: 1 | 2,
  budget: Budget,
): Html {
  if (!r.body.trim()) return html`<p class="meta">${T.emptyBody}</p>`;
  const { project } = c.nb.config;
  const plain = (before: Html) => {
    const shown = cut(r.body, budget.plain);
    budget.plain -= shown.length;
    return html`${before}<pre class="plain" tabindex="0">${shown}</pre>${shown.length < r.body.length && html`<p class="note">${T.cut}</p>`}`;
  };
  if (r.body.length > budget.render) return plain(html`<p class="note">${T.tooLong}</p>`);
  if (o.plain) return plain(html`<p class="meta"><a href="?">${T.showFormatted}</a></p>`);
  budget.render -= r.body.length;
  try {
    const rendered = (o.render ?? renderMarkdown)(r.body, {
      project,
      headingLevel: level + 1,
      recordHref: (id) => (byId.has(id) ? recordHref(project, id) : undefined),
    });
    return html`<div class="prose">${rendered}</div><p class="meta"><a href="?view=plain">${T.showPlain}</a></p>`;
  } catch {
    return plain(html`<p class="note">${T.renderFailed}</p>`);
  }
}

function article(
  c: ViewContext,
  r: IndexedRecord,
  byId: ById,
  o: RecordOptions,
  level: 1 | 2,
  budget: Budget,
): Html {
  const fresh = freshnessOf({ ...r.fm, type: r.type, created: r.created }, c.nb.config, c.now);
  const movedTo = text(r.fm.moved_to);
  const replacedBy = text(r.fm.superseded_by);
  const system = r.fm.managed_by === "external" && isMap(r.fm.source) ? text(r.fm.source.system) : undefined;
  return html`<article>
<h${level}>${r.title}</h${level}>
<p class="lead">${r.summary}</p>
<ul class="badges"><li class="badge">${typeLabel(r.type)}</li><li class="badge">${statusLabel(r.status)}</li><li class="badge ${r.trust === "verified" ? "ok" : "warn"}">${trustLabel(r.trust, r.fm.verified)}</li>${fresh !== "fresh" && html`<li class="badge warn">${FRESHNESS[fresh]}</li>`}</ul>
${system && html`<p class="meta">${T.source(systemLabel(system))}</p>`}
<p class="actions"><button class="button" type="button" hidden data-copy="${r.id}">${T.copyRef}</button></p>
${movedTo && html`<p class="note">${T.moved(movedTo)}</p>`}
${!movedTo && replacedBy && html`<p class="note">${T.replaced} ${refLink(c, replacedBy, byId)}</p>`}
${bodyOf(c, r, byId, o, level, budget)}
<section class="side"><h${level + 1}>${T.details}</h${level + 1}>${details(c, r, byId)}</section>
</article>
`;
}

function notFound(c: ViewContext): Page {
  const body = html`<div class="empty"><h1>${T.recordNotFound}</h1><p>${T.recordNotFoundHint}</p><p><a class="button" href="${projectHref(c.nb.config.project)}">${T.home}</a></p></div>`;
  return { status: 404, html: notebookPage(c, T.recordNotFound, body) };
}

/** One record, found by its reference only, never by a path (24 §5.2). */
export function recordPage(c: ViewContext, ref: string, o: RecordOptions = {}): Page {
  if (!REF_RE.test(ref)) return notFound(c);
  const { project, id } = parseRef(ref);
  if (project !== undefined && project !== c.nb.config.project) return notFound(c);
  const byId = new Map<string, IndexedRecord[]>();
  for (const r of c.index.records) {
    const same = byId.get(r.id);
    if (same) same.push(r);
    else byId.set(r.id, [r]);
  }
  const found = byId.get(id) ?? [];
  const [first] = found;
  if (!first) return notFound(c);
  const budget = { render: MAX_RENDER_CHARS, plain: MAX_PLAIN_CHARS };
  if (found.length === 1)
    return { status: 200, html: notebookPage(c, first.title, article(c, first, byId, o, 1, budget)) };
  const title = T.shared(found.length, id);
  const articles = found.slice(0, MAX_SAME_ID).map((r) => article(c, r, byId, o, 2, budget));
  const rest = found.length - articles.length;
  return {
    status: 200,
    html: notebookPage(
      c,
      title,
      html`<h1>${title}</h1>\n${articles}${rest > 0 && html`<p class="note">${T.sharedRest(rest)}</p>`}`,
    ),
  };
}
