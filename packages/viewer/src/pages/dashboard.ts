import { type IndexedRecord, summarizeNotebook } from "@aimem/core";
import { type Html, html } from "../html.js";
import { lensChoices } from "../query.js";
import { T, typeLabel, viewAllTasks } from "../strings.js";
import { projectHref, sectionHref, shown, type ViewContext } from "../view.js";
import { anchors, byCreated, byIdMap, idCounts, type Part } from "./cards.js";
import { decisionCard } from "./decisions.js";
import { handoffCard } from "./handoffs.js";
import { notebookPage } from "./layout.js";
import { importLink, typeMenu } from "./records.js";
import { groups, taskCard } from "./tasks.js";

/** How many cards each part of the dashboard shows; the link under it leads to all of them (24 §5.6). */
export const REVIEW_CARDS = 5;
export const RECENT_DECISIONS = 5;
export const LATEST_HANDOFFS = 3;

/** One part: a heading with the count, a few cards or a line that says there are none, and a link to the list. */
function part(id: string, heading: string, n: number, cards: Html[], empty: string, more: Part): Html {
  return html`<section aria-labelledby="d-${id}"><h2 id="d-${id}">${T.withCount(heading, n)}</h2>
${
  cards.length
    ? html`<ol class="results" role="list">
${cards}</ol>${more && html`<p class="more">${more}</p>`}`
    : html`<p class="meta">${empty}</p>`
}</section>
`;
}

/** Start page: what needs a look, what was decided and handed over lately, and the way to everything (24 §5.6). */
export function dashboard(c: ViewContext): string {
  const { project } = c.nb.config;
  const title = c.nb.config.name ?? c.nb.config.project;
  if (c.index.records.length === 0)
    return notebookPage(
      c,
      title,
      html`<h1>${title}</h1><div class="empty"><p>${T.none}</p>${importLink(c)}</div>`,
    );
  const records = shown(c);
  // Without its `live` argument: claims would need Git (24).
  const sum = summarizeNotebook(c.nb, { ...c.index, records: records as IndexedRecord[] }, c.now);
  const count = idCounts(c.index.records);
  const byId = byIdMap(c.index.records);
  const anchor = anchors();
  const o = (r: IndexedRecord) => ({ anchor: anchor(r.id), shared: (count.get(r.id) ?? 0) > 1 });
  const review = groups(c).get("review") ?? [];
  const decisions = records.filter((r) => r.type === "decision").sort(byCreated);
  const handoffs = records.filter((r) => r.type === "handoff").sort(byCreated);
  const lens = c.lens;
  const choices = lensChoices(c.nb, c.index.records);
  const view = (n: number, href: string, text: string) => n > 0 && html`<a href="${href}">${text}</a>`;
  return notebookPage(
    c,
    title,
    html`<h1>${title}</h1>
<form class="lens" method="get" action="${projectHref(project)}"><label for="lens">${T.role}</label><select id="lens" name="lens"><option value=""${!lens && html` selected`}>${T.allRolesOption}</option>${choices.map(
      (r) => html`<option value="${r}"${r === lens && html` selected`}>${r}</option>`,
    )}</select><button class="button" type="submit">${T.applyLens}</button></form>
<p class="meta">${T.lensHint}</p>
${c.lensIgnored && html`<p class="note">${T.filterIgnored}</p>`}
<p class="lead">${T.records(sum.total)}</p>
${part(
  "review",
  T.tasksInReview,
  review.length,
  review.slice(0, REVIEW_CARDS).map((r) => taskCard(c, r, { level: 3, ...o(r), summary: true })),
  T.noTasksInReview,
  view(
    review.length,
    sectionHref(project, "tasks", { status: "review", lens }),
    viewAllTasks("review", review.length),
  ),
)}
${part(
  "decisions",
  T.recentDecisions,
  decisions.length,
  decisions.slice(0, RECENT_DECISIONS).map((r) => decisionCard(c, r, o(r), byId, 3)),
  T.noneYet(T.decisions),
  view(
    decisions.length,
    sectionHref(project, "decisions", { lens }),
    T.viewAll(decisions.length, T.decisions, typeLabel("decision")),
  ),
)}
${part(
  "handoffs",
  T.latestHandoffs,
  handoffs.length,
  handoffs.slice(0, LATEST_HANDOFFS).map((r) => handoffCard(c, r, o(r), byId, 3)),
  T.noneYet(T.handoffs),
  view(
    handoffs.length,
    sectionHref(project, "handoffs", { lens }),
    T.viewAll(handoffs.length, T.handoffs, typeLabel("handoff")),
  ),
)}
<section aria-labelledby="d-browse"><h2 id="d-browse">${T.browse}</h2>
${typeMenu(c)}</section>
<section aria-labelledby="d-unreviewed"><h2 id="d-unreviewed">${T.unreviewed}</h2>
<ul><li>${T.agent}: ${sum.unreviewed.agent}</li><li>${T.inferred}: ${sum.unreviewed.inferred}</li></ul></section>`,
  );
}
