import type { IndexedRecord } from "@aimem/core";
import { type Html, html } from "../html.js";
import { externalSource } from "../source.js";
import { statusLabel, T, trustLabel, typeLabel } from "../strings.js";
import { recordHref, type ViewContext } from "../view.js";

/** What the lists of records have in common: a card, the page links, filter chips and the order (24 §5.3–5.5). */

/** How many records carry each id. Two files can share one, and then each card says which file it is. */
export function idCounts(records: readonly IndexedRecord[]): Map<string, number> {
  const count = new Map<string, number>();
  for (const r of records) count.set(r.id, (count.get(r.id) ?? 0) + 1);
  return count;
}

/**
 * The id of a card's link, which is where Back returns to (the script keeps it in the address). A second
 * record with the same id on the same page gets its own.
 */
export function anchors(): (id: string) => string {
  const used = new Map<string, number>();
  return (id) => {
    const k = (used.get(id) ?? 0) + 1;
    used.set(id, k);
    return k > 1 ? `r-${id}-${k}` : `r-${id}`;
  };
}

/** An optional piece of a page: `cond && html`...`` is `false`, `undefined` or an empty string when it is absent. */
export type Part = Html | false | "" | undefined;

export interface CardOptions {
  /** Level of the title: 2 in a list under the page title, 3 under the title of a column. */
  level?: 2 | 3;
  anchor: string;
  /** Another record has this id, so the file is shown. */
  shared: boolean;
  /** Badges before the type, such as a priority. */
  lead?: Part;
  /** Badge for the type and the status; left out where the heading of the list already says it. */
  type?: boolean;
  status?: boolean;
  /** A line below the badges. */
  meta?: Part;
  summary?: boolean;
  /** After the summary. */
  after?: Part;
}

/** One record in a list: title as a link, how far it can be trusted in words, where it comes from, and what it says. */
export function card(c: ViewContext, r: IndexedRecord, o: CardOptions): Html {
  const level = o.level ?? 2;
  const moved = r.fm.moved_to;
  const source = externalSource(r);
  return html`<li data-ref="${r.id}"><h${level}><a id="${o.anchor}" href="${recordHref(c.nb.config.project, r.id)}">${r.title}</a></h${level}>
<p class="facts">${o.lead}${o.type !== false && html`<span class="badge">${typeLabel(r.type)}</span> `}${o.status !== false && html`<span class="badge">${statusLabel(r.status)}</span> `}<span class="badge ${r.trust === "verified" ? "ok" : "warn"}">${trustLabel(r.trust, r.fm.verified)}</span>${r.notebook && html` <span class="badge">${r.notebook}</span>`} <span class="meta">${r.id}</span></p>
${source && html`<p class="meta">${T.source(source.name)}</p>`}${o.meta}${typeof moved === "string" && html`<p class="meta">${T.movedTo(moved)}</p>`}${o.shared && html`<p class="meta">${r.file}</p>`}${o.summary !== false && html`<p>${r.summary}</p>`}${o.after}</li>
`;
}

/** Previous and Next, for a list of more than one page. */
export function pager(hrefFor: (page: number) => string, page: number, last: number): Html | false {
  const to = (p: number, text: string, rel: string) =>
    html`<a class="button" rel="${rel}" href="${hrefFor(p)}">${text}</a> `;
  return (
    last > 1 &&
    html`<nav class="pages" aria-label="${T.pages}">${page > 1 && to(page - 1, T.previous, "prev")}${page < last && to(page + 1, T.next, "next")}</nav>`
  );
}

export interface Chip {
  text: string;
  href: string;
  current: boolean;
}

/** Links that narrow a list, each with its count. They are plain links, so they work without the script. */
export function chips(label: string, items: readonly Chip[]): Html {
  return html`<nav class="chips" aria-label="${label}">${items.map(
    (i) => html`<a${i.current && html` aria-current="true"`} href="${i.href}">${i.text}</a> `,
  )}</nav>`;
}

/** The records by id. Two files can carry one id, so each id has a list. */
export function byIdMap(records: readonly IndexedRecord[]): Map<string, IndexedRecord[]> {
  const by = new Map<string, IndexedRecord[]>();
  for (const r of records) {
    const same = by.get(r.id);
    if (same) same.push(r);
    else by.set(r.id, [r]);
  }
  return by;
}

/** Code-unit order, so that it does not depend on the language of the computer. */
export const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** The last ties of every list: id, then notebook, then file. */
export const byRecord = (a: IndexedRecord, b: IndexedRecord): number =>
  compare(a.id, b.id) || compare(a.notebook ?? "", b.notebook ?? "") || compare(a.file, b.file);
/** Newest update first. */
export const byUpdated = (a: IndexedRecord, b: IndexedRecord): number =>
  compare(b.updated, a.updated) || byRecord(a, b);
/** Newest first, as the latest handoff of the dashboard is picked; ties by id, notebook and file. */
export const byCreated = (a: IndexedRecord, b: IndexedRecord): number =>
  compare(b.created, a.created) || byRecord(a, b);
