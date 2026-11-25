import { type Html, html } from "../html.js";
import { T } from "../strings.js";
import { projectHref, type ViewContext } from "../view.js";

/** A whole page. `header` defaults to a link to the start page. */
export function layout(title: string, body: Html, header?: Html): string {
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
<main id="main" tabindex="-1">
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

/** A page about the notebook: its name, that it is read-only, and what is missing. */
export function notebookPage(c: ViewContext, title: string, body: Html): string {
  const { name, project } = c.nb.config;
  return layout(
    title,
    html`${notices(c)}${body}`,
    html`<a class="project" href="${projectHref(project)}">${name ?? project}</a><span class="badge">${T.readOnly}</span>`,
  );
}
