import type { IndexedRecord } from "@aimem/core";
import { RECORD_TYPES, STATUSES } from "@aimem/schema";
import { html } from "../html.js";
import { readChoice } from "../query.js";
import { dateLabel, severityLabel, T, typePlural } from "../strings.js";
import { type Page, type Section, sectionHref, type ViewContext } from "../view.js";
import { byUpdated, card } from "./cards.js";
import { notebookPage } from "./layout.js";
import { listPage } from "./lists.js";

/** The types that have a page of their own, which is where Browse sends. */
const OWN: Readonly<Record<string, Section>> = { decision: "decisions", task: "tasks", handoff: "handoffs" };

/** What an incident adds to a card: how serious, where, and since when. */
function incident(r: IndexedRecord): string[] {
  const services = Array.isArray(r.fm.services)
    ? r.fm.services.filter((s): s is string => typeof s === "string" && s !== "")
    : [];
  const started = typeof r.fm.started === "string" && r.fm.started ? dateLabel(r.fm.started) : undefined;
  return [
    ...(severityLabel(r.fm.severity) ? [severityLabel(r.fm.severity) as string] : []),
    ...(services.length ? [services.join(", ")] : []),
    ...(started ? [T.started(started)] : []),
  ];
}

/** Browse by type: a menu of the types with their counts, and the list of one type (24 §5.5). */
export function recordsPage(c: ViewContext, params: URLSearchParams): Page {
  const { project } = c.nb.config;
  const { value: type, unknown } = readChoice(params, "type", RECORD_TYPES);
  if (type === undefined) {
    const count = new Map<string, number>();
    for (const r of c.index.records) count.set(r.type, (count.get(r.type) ?? 0) + 1);
    const items = RECORD_TYPES.map((t) => {
      const own = OWN[t];
      const href = own ? sectionHref(project, own) : sectionHref(project, "records", { type: t });
      return html`<li class="type"><a href="${href}">${typePlural(t)} <span class="meta">${count.get(t) ?? 0}</span></a></li>
`;
    });
    return {
      status: 200,
      html: notebookPage(
        c,
        T.browseByType,
        html`<h1>${T.browseByType}</h1>${unknown && html`<p class="note">${T.filterIgnored}</p>`}<ul class="types" role="list">
${items}</ul>`,
        "",
        { current: "records" },
      ),
    };
  }
  return listPage(c, params, {
    section: "records",
    plural: typePlural(type),
    records: c.index.records.filter((r) => r.type === type),
    order: byUpdated,
    statuses: STATUSES[type],
    href: (o) => sectionHref(project, "records", { type, ...o }),
    card: (r, o) =>
      card(c, r, {
        ...o,
        type: false,
        meta: html`<p class="meta">${[T.updated(dateLabel(r.updated)), ...(type === "incident" ? incident(r) : [])].join(" · ")}</p>
`,
      }),
  });
}
