import { html } from "../html.js";
import { GUIDE } from "../strings.js";
import type { ViewContext } from "../view.js";
import { notebookPage } from "./layout.js";

/**
 * How to add documents (24 decision 3): the commands of `aimem import` and `aimem sources`, as text. The local
 * viewer is read-only, so the page has no form and nothing to upload.
 */
export function importPage(c: ViewContext): string {
  return notebookPage(
    c,
    GUIDE.title,
    html`<article><h1>${GUIDE.title}</h1>
<p>${GUIDE.intro}</p>
<p class="note">${GUIDE.visible}</p>
${GUIDE.sections.map(
  (s) => html`<h2>${s.heading}</h2>
${s.blocks.map((b) =>
  "text" in b
    ? html`<p>${b.text}</p>
`
    : html`<pre tabindex="0"><code>${b.commands.join("\n")}</code></pre>
`,
)}`,
)}</article>`,
  );
}
