import { type IndexedRecord, search, tokenize } from "@aimem/core";
import { parseRef, RECORD_TYPES, REF_RE, TRUST_LEVELS } from "@aimem/schema";
import { cut, type Html, html } from "../html.js";
import {
  ALL_STATUSES,
  hasFilters,
  PAGE_SIZE,
  type Query,
  readQuery,
  roleChoices,
  searchOptions,
  writeQuery,
} from "../query.js";
import { statusLabel, T, trustLabel, trustName, typeLabel } from "../strings.js";
import { type Page, recordHref, SEARCH_FORM, searchHref, type ViewContext } from "../view.js";
import { notebookPage } from "./layout.js";

/** How far down a body is looked at, and how much of it is shown, in UTF-16 units. */
const EXCERPT_SCAN = 20_000;
const EXCERPT_MAX = 240;
const BEFORE_MAX = 90;
const WORD_MAX = 60;

/** Markdown signs that stand alone (headings, lists, quotes, rules, table lines) say nothing in an excerpt. */
const SIGN = /^(?:#{1,6}|[-*+>|]|[-=*_]{3,}|[|:-]+)$/;

/** A long word, shortened at whole characters. */
const word = (w: string) => (w.length > WORD_MAX ? `${cut(w, WORD_MAX - 1)}…` : w);

/** The text around the first word that matches, as plain text. Words are compared as `search()` does. */
export function excerpt(body: string, terms: ReadonlySet<string>): string | undefined {
  const words = cut(body, EXCERPT_SCAN)
    .split(/\s+/)
    .filter((w) => w && !SIGN.test(w));
  const at = words.findIndex((w) => tokenize(w).some((t) => terms.has(t)));
  if (at < 0) return undefined;
  const out = [word(words[at] ?? "")];
  let size = out[0]?.length ?? 0;
  let first = at;
  for (let before = 0; first > 0 && at - first < 12; first--) {
    const w = word(words[first - 1] ?? "");
    before += w.length + 1;
    if (before > BEFORE_MAX) break;
    out.unshift(w);
    size += w.length + 1;
  }
  let last = at;
  // Four characters stay free for the two marks.
  for (; last < words.length - 1 && last - at < 18; last++) {
    const w = word(words[last + 1] ?? "");
    if (size + w.length + 1 > EXCERPT_MAX - 4) break;
    out.push(w);
    size += w.length + 1;
  }
  return `${first > 0 ? "… " : ""}${out.join(" ")}${last < words.length - 1 ? " …" : ""}`;
}

function select(name: string, label: string, chosen: string | undefined, options: [string, string][]): Html {
  return html`<div class="field"><label for="f-${name}">${label}</label><select id="f-${name}" name="${name}" form="${SEARCH_FORM}"><option value=""${!chosen && html` selected`}>${T.any}</option>${options.map(
    ([value, text]) => html`<option value="${value}"${value === chosen && html` selected`}>${text}</option>`,
  )}</select></div>`;
}

const filters = (
  x: Query,
  roles: readonly string[],
): Html => html`<div class="filters" role="group" aria-label="${T.filters}">
${select(
  "type",
  T.type,
  x.type,
  RECORD_TYPES.map((t) => [t, typeLabel(t)]),
)}
${select(
  "status",
  T.status,
  x.status,
  ALL_STATUSES.map((s) => [s, statusLabel(s)]),
)}
${select(
  "trust",
  T.trust,
  x.trust,
  TRUST_LEVELS.map((t) => [t, trustName(t)]),
)}
${select(
  "role",
  T.role,
  x.role,
  roles.map((r) => [r, r]),
)}
<div class="field check"><input type="checkbox" id="f-closed" name="closed" value="1" form="${SEARCH_FORM}"${x.closed && html` checked`}><label for="f-closed">${T.includeClosed}</label></div>
<button class="button" type="submit" form="${SEARCH_FORM}">${T.apply}</button>
</div>`;

function result(
  c: ViewContext,
  r: IndexedRecord,
  anchor: string,
  shared: boolean,
  terms: ReadonlySet<string>,
): Html {
  const found = excerpt(r.body, terms);
  const moved = r.fm.moved_to;
  return html`<li data-ref="${r.id}"><h2><a id="${anchor}" href="${recordHref(c.nb.config.project, r.id)}">${r.title}</a></h2>
<p class="facts"><span class="badge">${typeLabel(r.type)}</span> <span class="badge">${statusLabel(r.status)}</span> <span class="badge ${r.trust === "verified" ? "ok" : "warn"}">${trustLabel(r.trust, r.fm.verified)}</span>${r.notebook && html` <span class="badge">${r.notebook}</span>`} <span class="meta">${r.id}</span></p>
${typeof moved === "string" && html`<p class="meta">${T.movedTo(moved)}</p>`}${shared && html`<p class="meta">${r.file}</p>`}<p>${r.summary}</p>${found && html`<p class="excerpt">${found}</p>`}</li>
`;
}

function results(c: ViewContext, x: Query): { heading: string; title: string; body: Html } {
  const { project } = c.nb.config;
  const hits = search(c.index, x.q, searchOptions(x)).filter((h) => !x.trust || h.record.trust === x.trust);
  const n = hits.length;
  const last = Math.max(1, Math.ceil(n / PAGE_SIZE));
  const page = Math.min(x.page, last);
  const heading = T.results(n, x.q);
  if (!n)
    return {
      heading,
      title: heading,
      body: html`<div class="empty"><h2>${T.noMatch}</h2><p>${T.wholeWords}</p>${
        hasFilters(x) &&
        html`<p><a class="button" href="${searchHref(project)}?${new URLSearchParams({ q: x.q })}">${T.clearFilters}</a></p>`
      }</div>`,
    };
  const count = new Map<string, number>();
  for (const r of c.index.records) count.set(r.id, (count.get(r.id) ?? 0) + 1);
  const terms = new Set(tokenize(x.q));
  const from = (page - 1) * PAGE_SIZE;
  const shown = hits.slice(from, from + PAGE_SIZE);
  // The id of a link is where Back returns to; a second record with the same id gets its own.
  const used = new Map<string, number>();
  const items = shown.map(({ record: r }) => {
    const k = (used.get(r.id) ?? 0) + 1;
    used.set(r.id, k);
    return result(c, r, k > 1 ? `r-${r.id}-${k}` : `r-${r.id}`, (count.get(r.id) ?? 0) > 1, terms);
  });
  const to = (p: number, text: string, rel: string) =>
    html`<a class="button" rel="${rel}" href="${searchHref(project)}?${writeQuery(x, p)}">${text}</a> `;
  return {
    heading,
    title: page > 1 ? `${heading}, ${T.page(page)}` : heading,
    body: html`<p class="meta">${T.showing(from + 1, from + shown.length, n)} ${T.keywordOnly}</p>
<ol class="results" role="list">
${items}</ol>
${
  last > 1 &&
  html`<nav class="pages" aria-label="${T.pages}">${page > 1 && to(page - 1, T.previous, "prev")}${page < last && to(page + 1, T.next, "next")}</nav>`
}`,
  };
}

/** Keyword search: the hits and order of core `search()`, 25 per page (24 §5.3). */
export function searchPage(c: ViewContext, params: URLSearchParams): Page {
  const roles = roleChoices(c.index.records);
  const x = readQuery(params, roles);
  const { project } = c.nb.config;
  const asked = x.q.trim() !== "";
  const found = asked && c.index.records.length > 0 ? results(c, x) : undefined;
  const ref = REF_RE.test(x.q.trim()) ? parseRef(x.q.trim()) : undefined;
  const direct =
    ref &&
    (ref.project === undefined || ref.project === project) &&
    c.index.records.some((r) => r.id === ref.id) &&
    ref.id;
  return {
    status: 200,
    html: notebookPage(
      c,
      found ? found.title : T.search,
      html`<h1>${found ? found.heading : T.search}</h1>
${filters(x, roles)}
${x.cutOff && html`<p class="note">${T.queryCut}</p>`}
${direct && html`<p><a class="button" href="${recordHref(project, direct)}">${T.open(direct)}</a></p>`}
${found ? found.body : html`<div class="empty"><p>${c.index.records.length ? T.typeAWord : T.none}</p></div>`}`,
      x.q,
    ),
  };
}
