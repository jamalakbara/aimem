import type { IndexedRecord } from "@aimem/core";
import { type Html, html } from "../html.js";
import { PAGE_SIZE, readChoice, readPage } from "../query.js";
import { columnLabel, listHeading, T } from "../strings.js";
import type { Page, Section, ViewContext } from "../view.js";
import { anchors, type Chip, chips, idCounts, type Part, pager } from "./cards.js";
import { notebookPage } from "./layout.js";

/** A status that is not in the schema: the index keeps such records, so the lists show them (24 §5.4). */
const OTHER = "other";

export interface ListSpec {
  /** The link of the header that is marked as open. */
  section: Section;
  /** As in the heading: `Decisions`. */
  plural: string;
  /** The records of this list. */
  records: readonly IndexedRecord[];
  order: (a: IndexedRecord, b: IndexedRecord) => number;
  /** The statuses of the schema, for the chips. A list without them has no filter. */
  statuses?: readonly string[];
  /** The address of a page of this list. */
  href: (o: { status?: string; page?: number }) => string;
  card: (r: IndexedRecord, o: { anchor: string; shared: boolean }) => Html;
  /** Above the list, such as the note about an address that was ignored. */
  note?: Part;
}

/** A list of records of one kind, in one order, 25 a page, narrowed by status with chips (24 §5.5). */
export function listPage(c: ViewContext, params: URLSearchParams, spec: ListSpec): Page {
  const known = new Set(spec.statuses ?? []);
  const statusOf = (r: IndexedRecord) => (!spec.statuses || known.has(r.status) ? r.status : OTHER);
  const sorted = [...spec.records].sort(spec.order);
  const by = new Map<string, IndexedRecord[]>();
  for (const r of sorted) {
    const key = statusOf(r);
    const same = by.get(key);
    if (same) same.push(r);
    else by.set(key, [r]);
  }
  const choices = spec.statuses ? [...spec.statuses, OTHER] : [];
  const { value: status, unknown } = readChoice(params, "status", choices);
  const note = html`${spec.note}${unknown && html`<p class="note">${T.filterIgnored}</p>`}`;
  const heading = listHeading(spec.plural, status);
  const shell = (title: string, body: Html): Page => ({
    status: 200,
    html: notebookPage(c, title, body, "", { current: spec.section }),
  });
  if (sorted.length === 0)
    return shell(
      heading,
      html`<h1>${heading}</h1>${note}<div class="empty"><p>${T.noneYet(spec.plural)}</p></div>`,
    );

  const nav: Chip[] = spec.statuses
    ? [
        { text: T.withCount(T.any, sorted.length), href: spec.href({}), current: status === undefined },
        ...choices
          .filter((s) => s !== OTHER || (by.get(s)?.length ?? 0) > 0)
          .map((s) => ({
            text: T.withCount(columnLabel(s), by.get(s)?.length ?? 0),
            href: spec.href({ status: s }),
            current: status === s,
          })),
      ]
    : [];
  const filter = nav.length > 0 && chips(T.status, nav);
  const list = status === undefined ? sorted : (by.get(status) ?? []);
  const n = list.length;
  const last = Math.max(1, Math.ceil(n / PAGE_SIZE));
  const page = Math.min(readPage(params), last);
  const title = page > 1 ? `${T.titled(heading, n)}, ${T.page(page)}` : T.titled(heading, n);
  if (n === 0)
    return shell(
      title,
      html`<h1>${heading}</h1>${note}${filter}<div class="empty"><h2>${T.noMatch}</h2><p><a class="button" href="${spec.href({})}">${T.clearFilters}</a></p></div>`,
    );
  const count = idCounts(c.index.records);
  const anchor = anchors();
  const from = (page - 1) * PAGE_SIZE;
  const shown = list.slice(from, from + PAGE_SIZE);
  const items = shown.map((r) => spec.card(r, { anchor: anchor(r.id), shared: (count.get(r.id) ?? 0) > 1 }));
  return shell(
    title,
    html`<h1>${heading}</h1>${note}${filter}${last > 1 && html`<p class="meta">${T.showing(from + 1, from + shown.length, n)}</p>`}
<ol class="results" role="list">
${items}</ol>
${pager((p) => spec.href({ ...(status ? { status } : {}), page: p }), page, last)}`,
  );
}
