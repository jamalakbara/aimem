import { type Html, html } from "../html.js";
import { MAX_QUERY } from "../query.js";
import { T } from "../strings.js";
import {
  projectHref,
  SEARCH_FORM,
  SECTIONS,
  type Section,
  searchHref,
  sectionHref,
  type ViewContext,
} from "../view.js";

/** A whole page. `header` defaults to a link to the start page. `wide` gives the content more room (the task board). */
export function layout(title: string, body: Html, header?: Html, wide = false): string {
  return String(html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · ${T.app}</title>
<link rel="stylesheet" href="/assets/style.css">
<script src="/assets/app.js" defer></script>
</head>
<body>
<a class="skip" href="#main">${T.skip}</a>
<header class="top">${header ?? html`<a class="project" href="/">${T.app}</a>`}</header>
<main id="main" tabindex="-1"${wide && html` class="wide"`}>
${body}
</main>
</body>
</html>
`);
}

const MAX_SHOWN = 20;

/** Everything that makes the data on the page incomplete. */
function notices(c: ViewContext): Html | false {
  const lines = [...(c.stale ? [c.stale] : []), ...c.warnings];
  const files = c.problems;
  if (!lines.length && !files.length) return false;
  const rest = (n: number) => n > MAX_SHOWN && html`<li>${T.more(n - MAX_SHOWN)}</li>`;
  return html`<aside class="notice" aria-label="${T.notices}">
${
  lines.length > 0 &&
  html`<ul>${lines.slice(0, MAX_SHOWN).map((l) => html`<li>${l}</li>\n`)}${rest(lines.length)}</ul>`
}
${
  files.length > 0 &&
  html`<details><summary>${T.notShown(files.length)}</summary><ul>${files
    .slice(0, MAX_SHOWN)
    .map((p) => html`<li>${p.file}: ${p.message}</li>\n`)}${rest(files.length)}</ul></details>`
}
</aside>`;
}

const SECTION_NAMES: Record<Section, string> = {
  tasks: T.tasks,
  decisions: T.decisions,
  handoffs: T.handoffs,
  records: T.browse,
};

/** The lists of records, as links. The page that is shown is marked as the current one. */
function sections(project: string, current?: Section, lens?: string): Html {
  return html`<nav class="sections" aria-label="${T.sections}">${SECTIONS.map(
    (s) =>
      html`<a${s === current && html` aria-current="page"`} href="${sectionHref(project, s, { lens })}">${SECTION_NAMES[s]}</a>`,
  )}</nav>`;
}

export interface NotebookPageOptions {
  /** The list that is open, for the header. */
  current?: Section;
  wide?: boolean;
  /** This page without the lens, for "Show all roles"; given by the pages that a lens narrows. */
  lensOff?: string;
}

/** A page about the notebook: its name, that it is read-only, the lists, the search box, and what is missing. */
export function notebookPage(
  c: ViewContext,
  title: string,
  body: Html,
  q = "",
  o: NotebookPageOptions = {},
): string {
  const { name, project } = c.nb.config;
  const lens =
    c.lens &&
    o.lensOff !== undefined &&
    html`<p class="lens">${T.lensShown(c.lens)} · <a href="${o.lensOff}">${T.allRoles}</a></p>`;
  return layout(
    c.lens ? `${title} · ${c.lens}` : title,
    html`${notices(c)}${lens}${body}`,
    html`<a class="project" href="${projectHref(project, c.lens)}">${name ?? project}</a><span class="badge">${T.readOnly}</span>${sections(project, o.current, c.lens)}<form class="search" id="${SEARCH_FORM}" action="${searchHref(project)}" role="search"><input id="q" type="search" name="q" value="${q}" maxlength="${MAX_QUERY}" placeholder="${T.searchRecords}" aria-label="${T.searchRecords}" aria-keyshortcuts="Control+K Meta+K" autocomplete="off" spellcheck="false"><button class="button" type="submit">${T.search}</button></form>`,
    o.wide,
  );
}
