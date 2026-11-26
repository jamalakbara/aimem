import type { IndexedRecord } from "@aimem/core";
import { type Html, html } from "../html.js";
import { dateLabel, T } from "../strings.js";
import { type Page, sectionHref, shown, type ViewContext } from "../view.js";
import { byCreated, byIdMap, card } from "./cards.js";
import { listPage } from "./lists.js";
import { refLink } from "./record.js";

const text = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** One handoff with its date, author, branch, and the task it worked on. */
export function handoffCard(
  c: ViewContext,
  r: IndexedRecord,
  o: { anchor: string; shared: boolean },
  byId: ReturnType<typeof byIdMap>,
  level: 2 | 3 = 2,
): Html {
  const task = text(r.fm.task);
  const branch = text(r.fm.branch);
  return card(c, r, {
    ...o,
    level,
    // Every handoff is `final`, and the page says what they are.
    type: false,
    status: false,
    meta: html`<p class="meta">${dateLabel(r.created)} · ${r.author}${branch && html` · ${T.branch}: ${branch}`}</p>
${
  task &&
  html`<p class="meta">${T.taskOfHandoff}: ${refLink(c, task, byId)}</p>
`
}`,
  });
}

/** Handoff feed: the end-of-session notes, newest first, as the latest handoff of the dashboard is picked. */
export function handoffsPage(c: ViewContext, params: URLSearchParams): Page {
  const { project } = c.nb.config;
  const byId = byIdMap(c.index.records);
  return listPage(c, params, {
    section: "handoffs",
    plural: T.handoffs,
    records: shown(c).filter((r) => r.type === "handoff"),
    order: byCreated,
    href: (o) => sectionHref(project, "handoffs", o),
    card: (r, o) => handoffCard(c, r, o, byId),
  });
}
