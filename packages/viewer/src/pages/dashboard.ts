import { summarizeNotebook } from "@aimem/core";
import type { Snapshot } from "../cache.js";
import { type Html, html } from "../html.js";
import { T } from "../strings.js";

export function dashboard(s: Snapshot, now: Date): Html {
  // Without its `live` argument: claims would need Git (24).
  const sum = summarizeNotebook(s.nb, s.index, now);
  const rows = Object.entries(sum.counts).flatMap(([type, by]) =>
    Object.entries(by).map(([status, n]) => html`<tr><td>${type}</td><td>${status}</td><td>${n}</td></tr>\n`),
  );
  const notices = [...(s.stale ? [s.stale] : []), ...s.warnings];
  return html`<h1>${s.nb.config.name ?? s.nb.config.project}</h1>
<p>${T.readOnly} · ${T.records(sum.total)}</p>
${notices.length > 0 && html`<h2>${T.notices}</h2><ul>${notices.map((n) => html`<li>${n}</li>\n`)}</ul>`}
<h2>${T.byStatus}</h2>
${
  rows.length
    ? html`<table><thead><tr><th scope="col">${T.type}</th><th scope="col">${T.status}</th><th scope="col">${T.count}</th></tr></thead><tbody>${rows}</tbody></table>`
    : html`<p>${T.none}</p>`
}
<h2>${T.unreviewed}</h2>
<ul><li>${T.agent}: ${sum.unreviewed.agent}</li><li>${T.inferred}: ${sum.unreviewed.inferred}</li></ul>
${
  sum.lastHandoff &&
  html`<h2>${T.latestHandoff}</h2><p>${sum.lastHandoff.created} ${sum.lastHandoff.author}: ${sum.lastHandoff.summary}</p>`
}
${
  s.problems.length > 0 &&
  html`<h2>${T.notShown}</h2><ul>${s.problems.map((p) => html`<li>${p.file}: ${p.message}</li>\n`)}</ul>`
}`;
}
