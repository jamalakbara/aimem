import { ID_RE, TYPE_PREFIX } from "@aimem/schema";
import MarkdownIt from "markdown-it";
import { type Html, html, safeExternalHref } from "./html.js";

/** Every element the renderer can write. */
export const ALLOWED_TAGS: readonly string[] = [
  ...[
    "a",
    "blockquote",
    "br",
    "code",
    "div",
    "em",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "li",
    "ol",
    "p",
    "pre",
  ],
  ...["s", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul"],
];
/**
 * Every attribute the renderer can write. Only `href` carries an author's value, and only after
 * `safeExternalHref`; `start` is an integer and the others are constants.
 */
export const ALLOWED_ATTRS: Readonly<Record<string, readonly string[]>> = {
  a: ["href", "rel"],
  div: ["class", "tabindex"],
  ol: ["start"],
  pre: ["tabindex"],
  th: ["scope"],
};

export interface MarkdownContext {
  /** This notebook's project slug, for `<project>:<id>` refs. */
  project: string;
  /** Viewer address of a record that exists, by id. */
  recordHref: (id: string) => string | undefined;
  /** Level for the highest heading in the body; default 2, below the page title. */
  headingLevel?: number;
}

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
// Links are judged when they are written, so a refused one keeps its label instead of its markup.
md.validateLink = () => true;

type Token = ReturnType<typeof md.parse>[number];

const PREFIXES = Object.values(TYPE_PREFIX).join("|");
/** `[[ref]]`, or a bare `id` / `project:id` that is not part of a longer word or path. */
const REFS = new RegExp(
  `\\[\\[([a-z0-9:-]{1,80})\\]\\]|(?<![\\w/:.-])((?:[a-z0-9][a-z0-9-]{0,63}:)?(?:${PREFIXES})-[0-9a-z]{8})(?![\\w/-])`,
  "g",
);

function withRefs(text: string, ctx: MarkdownContext): Html {
  const out: (Html | string)[] = [];
  let at = 0;
  for (const m of text.matchAll(REFS)) {
    const ref = m[1] ?? m[2] ?? "";
    const colon = ref.lastIndexOf(":");
    const id = ref.slice(colon + 1);
    const local = colon < 0 || ref.slice(0, colon) === ctx.project;
    const href = local && ID_RE.test(id) ? ctx.recordHref(id) : undefined;
    if (!href) continue;
    out.push(text.slice(at, m.index), html`<a href="${href}">${ref}</a>`);
    at = m.index + m[0].length;
  }
  out.push(text.slice(at));
  return html`${out}`;
}

const link = (href: string) => html`<a href="${href}" rel="noopener noreferrer">`;

const INLINE: ReadonlyMap<string, Html> = new Map([
  ["softbreak", html`\n`],
  ["hardbreak", html`<br>\n`],
  ["strong_open", html`<strong>`],
  ["strong_close", html`</strong>`],
  ["em_open", html`<em>`],
  ["em_close", html`</em>`],
  ["s_open", html`<s>`],
  ["s_close", html`</s>`],
]);

function inline(tokens: readonly Token[], ctx: MarkdownContext): Html {
  const out: (Html | string)[] = [];
  /** One entry per open link: whether `<a>` was written. */
  const links: boolean[] = [];
  for (const t of tokens) {
    const mark = INLINE.get(t.type);
    if (mark) {
      out.push(mark);
      continue;
    }
    switch (t.type) {
      case "text":
        out.push(links.includes(true) ? t.content : withRefs(t.content, ctx));
        break;
      case "code_inline":
        out.push(html`<code>${t.content}</code>`);
        break;
      case "link_open": {
        const href = links.includes(true) ? undefined : safeExternalHref(String(t.attrGet("href") ?? ""));
        links.push(href !== undefined);
        if (href) out.push(link(href));
        break;
      }
      case "link_close":
        if (links.pop()) out.push(html`</a>`);
        break;
      case "image": {
        const alt = t.content.trim();
        const label = alt ? `Image: ${alt}` : "Image";
        const src = String(t.attrGet("src") ?? "");
        const href = links.includes(true) ? undefined : safeExternalHref(src);
        out.push(href ? html`${link(href)}${label}</a>` : label);
        break;
      }
      default:
        out.push(t.content);
    }
  }
  return html`${out}`;
}

const BLOCKS: ReadonlyMap<string, Html> = new Map([
  ["blockquote_open", html`<blockquote>\n`],
  ["blockquote_close", html`</blockquote>\n`],
  ["bullet_list_open", html`<ul>\n`],
  ["bullet_list_close", html`</ul>\n`],
  ["ordered_list_close", html`</ol>\n`],
  ["list_item_open", html`<li>`],
  ["list_item_close", html`</li>\n`],
  ["hr", html`<hr>\n`],
  // A wide table scrolls sideways, so the keyboard must reach it.
  ["table_open", html`<div class="scroll" tabindex="0"><table>\n`],
  ["table_close", html`</table></div>\n`],
  ["thead_open", html`<thead>\n`],
  ["thead_close", html`</thead>\n`],
  ["tbody_open", html`<tbody>\n`],
  ["tbody_close", html`</tbody>\n`],
  ["tr_open", html`<tr>`],
  ["tr_close", html`</tr>\n`],
  ["th_open", html`<th scope="col">`],
  ["th_close", html`</th>`],
  ["td_open", html`<td>`],
  ["td_close", html`</td>`],
]);

const levelOf = (t: Token) => Number(t.tag.slice(1));

/** Markdown as HTML from `ALLOWED_TAGS` and `ALLOWED_ATTRS` only; anything else becomes text. */
export function renderMarkdown(body: string, ctx: MarkdownContext): Html {
  const out: (Html | string)[] = [];
  const tokens = md.parse(body, {});
  // Bodies start at `#` or `##`; the highest level used becomes `headingLevel` so no level is skipped.
  const top = tokens.reduce((min, t) => (t.type === "heading_open" ? Math.min(min, levelOf(t)) : min), 6);
  const shift = Math.max(2, ctx.headingLevel ?? 2) - top;
  const heading = (t: Token) => Math.min(Math.max(levelOf(t) + shift, 2), 6);
  tokens.forEach((t, i) => {
    const block = BLOCKS.get(t.type);
    if (block) {
      out.push(block);
      return;
    }
    switch (t.type) {
      case "inline":
        out.push(inline(t.children ?? [], ctx));
        break;
      case "paragraph_open":
        // In a tight list the paragraph tags are left out.
        if (!t.hidden) out.push(html`<p>`);
        break;
      case "paragraph_close":
        if (!t.hidden) out.push(html`</p>\n`);
        else if (tokens[i + 1]?.type !== "list_item_close") out.push("\n");
        break;
      case "heading_open":
        out.push(html`<h${heading(t)}>`);
        break;
      case "heading_close":
        out.push(html`</h${heading(t)}>\n`);
        break;
      case "ordered_list_open": {
        const start = Number(t.attrGet("start") ?? 1);
        out.push(Number.isSafeInteger(start) && start !== 1 ? html`<ol start="${start}">\n` : html`<ol>\n`);
        break;
      }
      case "code_block":
      case "fence":
        // A wide block scrolls sideways, so the keyboard must reach it.
        out.push(html`<pre tabindex="0"><code>${t.content}</code></pre>\n`);
        break;
      default:
        out.push(t.content);
    }
  });
  return html`${out}`;
}
