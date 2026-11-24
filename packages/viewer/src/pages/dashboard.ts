import { summarizeNotebook } from "@aimem/core";
import { html } from "../html.js";
import { statusLabel, T, typeLabel } from "../strings.js";
import type { ViewContext } from "../view.js";
import { notebookPage } from "./layout.js";

export function dashboard(c: ViewContext): string {
  // Without its `live` argument: claims would need Git (24).
  const sum = summarizeNotebook(c.nb, c.index, c.now);
  const rows = Object.entries(sum.counts).flatMap(([type, by]) =>
    Object.entries(by).map(
      ([status, n]) =>
        html`<tr><td>${typeLabel(type)}</td><td>${statusLabel(status)}</td><td>${n}</td></tr>\n`,
    ),
  );
  const title = c.nb.config.name ?? c.nb.config.project;
  return notebookPage(
    c,
    title,
    html`<article><h1>${title}</h1>
<p class="lead">${T.records(sum.total)}</p>
<h2>${T.byStatus}</h2>
${
  rows.length
    ? html`<div class="scroll" tabindex="0"><table><thead><tr><th scope="col">${T.type}</th><th scope="col">${T.status}</th><th scope="col">${T.count}</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : html`<p>${T.none}</p>`
}
<h2>${T.unreviewed}</h2>
<ul><li>${T.agent}: ${sum.unreviewed.agent}</li><li>${T.inferred}: ${sum.unreviewed.inferred}</li></ul>
${
  sum.lastHandoff &&
  html`<h2>${T.latestHandoff}</h2><p>${sum.lastHandoff.created} ${sum.lastHandoff.author}: ${sum.lastHandoff.summary}</p>`
}</article>`,
  );
}
