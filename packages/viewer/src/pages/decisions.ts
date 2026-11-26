import type { IndexedRecord } from "@aimem/core";
import { STATUSES } from "@aimem/schema";
import { type Html, html } from "../html.js";
import { dateLabel, T } from "../strings.js";
import { type Page, sectionHref, shown, type ViewContext } from "../view.js";
import { byCreated, byIdMap, card } from "./cards.js";
import { listPage } from "./lists.js";
import { refLink } from "./record.js";

const text = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** One decision with its date and author, and one step each way along the chain of replacements. */
export function decisionCard(
  c: ViewContext,
  r: IndexedRecord,
  o: { anchor: string; shared: boolean },
  byId: ReturnType<typeof byIdMap>,
  level: 2 | 3 = 2,
): Html {
  const replaces = text(r.fm.supersedes);
  const replacedBy = text(r.fm.superseded_by);
  return card(c, r, {
    ...o,
    level,
    type: false,
    meta: html`<p class="meta">${dateLabel(r.created)} · ${r.author}</p>
${
  replaces &&
  html`<p class="meta">${T.replaces} ${refLink(c, replaces, byId)}</p>
`
}${
  replacedBy &&
  html`<p class="meta">${T.replacedBy} ${refLink(c, replacedBy, byId)}</p>
`
}`,
  });
}

/**
 * Decision timeline: every decision, newest first. A decision points one step to the one it replaced and to the
 * one that replaced it, as written; the chain is followed by opening a record, so a loop cannot hang the page.
 */
export function decisionsPage(c: ViewContext, params: URLSearchParams): Page {
  const { project } = c.nb.config;
  const byId = byIdMap(c.index.records);
  return listPage(c, params, {
    section: "decisions",
    plural: T.decisions,
    records: shown(c).filter((r) => r.type === "decision"),
    order: byCreated,
    statuses: STATUSES.decision,
    href: (o) => sectionHref(project, "decisions", o),
    card: (r: IndexedRecord, o) => decisionCard(c, r, o, byId),
  });
}
