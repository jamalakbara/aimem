import { html } from "../html.js";
import { dateLabel, T } from "../strings.js";
import { type Page, sectionHref, type ViewContext } from "../view.js";
import { byCreated, byIdMap, card } from "./cards.js";
import { listPage } from "./lists.js";
import { refLink } from "./record.js";

const text = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Handoff feed: the end-of-session notes, newest first, as the latest handoff of the dashboard is picked. */
export function handoffsPage(c: ViewContext, params: URLSearchParams): Page {
  const { project } = c.nb.config;
  const byId = byIdMap(c.index.records);
  return listPage(c, params, {
    section: "handoffs",
    plural: T.handoffs,
    records: c.index.records.filter((r) => r.type === "handoff"),
    order: byCreated,
    href: (o) => sectionHref(project, "handoffs", o),
    card: (r, o) => {
      const task = text(r.fm.task);
      const branch = text(r.fm.branch);
      return card(c, r, {
        ...o,
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
    },
  });
}
