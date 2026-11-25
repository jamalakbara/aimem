/** The one stylesheet, served as a constant. Roles: ground, panel, ink steps, line; system fonts; light and dark. */
export const STYLE = `
:root {
  color-scheme: light dark;
  --ground: #f9f9f8; --panel: #fff; --well: #f1f0ef; --line: #dad9d6; --edge: #8d8d86;
  --ink: #21201c; --ink-2: #63635e; --link: #0d5cab; --focus: #21201c;
  --ok-bg: #e6f6eb; --ok: #18613a; --warn-bg: #fff7c2; --warn: #7a5200;
  --ring: 0 0 0 1px rgb(33 32 28 / .08), 0 1px 2px 0 rgb(33 32 28 / .12);
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ground: #080807; --panel: #191918; --well: #222221; --line: #3b3a37; --edge: #7c7b74;
    --ink: #eeeeec; --ink-2: #b5b3ad; --link: #8ec8ff; --focus: #eeeeec;
    --ok-bg: #132d21; --ok: #7fdca4; --warn-bg: #2d2305; --warn: #f5d24a;
    --ring: 0 0 0 .5px #494844, 0 1px 2px 0 rgb(0 0 0 / .5);
  }
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--ground); color: var(--ink); overflow-wrap: anywhere;
  font: 15px/24px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
a { color: var(--link); text-underline-offset: 2px; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 4px; }
main:focus { outline: none; }
.skip { position: absolute; left: 20px; top: -60px; padding: 10px 14px; background: var(--panel); z-index: 1; }
.skip:focus { top: 8px; }
.top {
  display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 8px 20px;
  border-bottom: 1px solid var(--line); background: var(--panel);
}
.project { color: var(--ink); text-decoration: none; padding: 10px 0; }
.project:hover { text-decoration: underline; }
.search { display: flex; gap: 8px; margin-left: auto; flex: 0 1 420px; min-width: 0; }
.search .button, .filters .button { flex: none; white-space: nowrap; }
input[type="search"], select {
  min-height: 36px; padding: 0 12px; border: 0; border-radius: 6px; background: var(--well); color: var(--ink);
  box-shadow: inset 0 0 0 1px var(--edge); font: inherit; font-size: 14px; min-width: 0; width: 100%;
}
input::placeholder { color: var(--ink-2); opacity: 1; }
main { max-width: 840px; margin: 0 auto; padding: 24px 20px 64px; }
article, .empty { unicode-bidi: isolate; background: var(--panel); border-radius: 8px; box-shadow: var(--ring); padding: 24px; }
article + article { margin-top: 24px; }
h1, h2, h3, h4, h5, h6 { font-weight: 600; margin: 24px 0 8px; line-height: 1.35; unicode-bidi: isolate; }
h1 { font-size: 24px; margin-top: 0; }
article > h2:first-child { margin-top: 0; }
h2 { font-size: 18px; } h3 { font-size: 16px; } h4, h5, h6 { font-size: 15px; }
p, li, dd, td, th, pre, span { unicode-bidi: isolate; }
p { margin: 0 0 12px; }
.lead { color: var(--ink-2); }
.meta { color: var(--ink-2); font-size: 14px; }
.badges { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; margin: 0 0 16px; padding: 0; }
.badge {
  display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 13px; line-height: 20px;
  background: var(--well); color: var(--ink);
}
.badge.ok { background: var(--ok-bg); color: var(--ok); }
.badge.warn, .note { background: var(--warn-bg); color: var(--warn); }
.note { padding: 10px 14px; border-radius: 6px; }
.note .meta, .note a { color: inherit; }
.notice { margin-bottom: 16px; padding: 12px 16px 1px; border-radius: 8px; background: var(--warn-bg); color: var(--warn); }
.notice details { margin-bottom: 12px; }
.notice summary { cursor: pointer; min-height: 24px; }
.button {
  display: inline-flex; align-items: center; min-height: 36px; padding: 0 14px; border: 0; border-radius: 6px;
  background: var(--panel); color: var(--ink); box-shadow: var(--ring); font: inherit; font-size: 14px;
  text-decoration: none; cursor: pointer;
}
.button[data-copy] { min-inline-size: 136px; justify-content: center; }
.button[hidden] { display: none; }
.button:hover { background: var(--well); }
.prose > :first-child { margin-top: 0; }
.prose ul, .prose ol { padding-left: 24px; margin: 0 0 12px; }
blockquote { margin: 0 0 12px; padding-left: 16px; border-left: 2px solid var(--line); color: var(--ink-2); }
code, pre { font: 13px/20px var(--mono); }
code { background: var(--well); border-radius: 4px; padding: 1px 4px; }
pre { margin: 0 0 12px; padding: 12px 14px; border-radius: 6px; background: var(--well); overflow: auto; overflow-wrap: normal; }
pre code { background: none; padding: 0; }
.plain { white-space: pre-wrap; overflow-wrap: anywhere; }
hr { border: 0; border-top: 1px solid var(--line); margin: 24px 0; }
.scroll { overflow-x: auto; margin: 0 0 12px; }
table { border-collapse: collapse; width: 100%; font-size: 14px; overflow-wrap: break-word; }
th, td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; }
th { font-weight: 600; }
.side { margin-top: 32px; padding-top: 8px; border-top: 1px solid var(--line); }
.details { margin: 0; }
.details > div { display: grid; grid-template-columns: 140px 1fr; gap: 12px; padding: 6px 0; }
dt { color: var(--ink-2); }
dd { margin: 0; }
.value + .value { margin-left: 8px; }
.filters { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; margin: 0 0 24px; }
.field { flex: 1 1 130px; min-width: 0; }
.field label { display: block; color: var(--ink-2); font-size: 14px; }
.field.check { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; min-height: 36px; }
.field.check input { width: 18px; height: 18px; margin: 0; }
.field.check label { color: var(--ink); }
.results { list-style: none; margin: 0 0 24px; padding: 0; }
.results li { background: var(--panel); border-radius: 8px; box-shadow: var(--ring); padding: 16px 20px; margin: 0 0 12px; }
.results h2 { font-size: 16px; margin: 0 0 8px; }
.results p { margin: 0 0 8px; }
.results p:last-child { margin: 0; }
.facts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.excerpt { color: var(--ink-2); font-size: 14px; }
.pages { display: flex; gap: 12px; }
.empty { text-align: center; padding: 48px 24px; }
.sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.sections { display: flex; gap: 4px; }
.sections a { display: inline-flex; align-items: center; min-height: 36px; padding: 0 10px; border-radius: 6px; color: var(--ink); text-decoration: none; }
.sections a:hover, .sections a[aria-current] { background: var(--well); }
.sections a[aria-current] { font-weight: 600; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 20px; }
.chips a { display: inline-flex; align-items: center; min-height: 36px; padding: 0 12px; border-radius: 18px; background: var(--panel); box-shadow: var(--ring); color: var(--ink); text-decoration: none; font-size: 14px; }
.chips a:hover { background: var(--well); }
.chips a[aria-current] { font-weight: 600; box-shadow: inset 0 0 0 2px var(--ink); }
main.wide { max-width: 1320px; }
.board { display: grid; grid-template-columns: 1fr; gap: 16px; align-items: start; }
@media (min-width: 768px) { .board { grid-template-columns: repeat(3, 1fr); } }
@media (min-width: 1100px) { .board { grid-template-columns: repeat(6, 1fr); } }
.board section { background: var(--well); border-radius: 8px; padding: 12px; min-width: 0; }
.board .other { grid-column: 1 / -1; }
.board h2 { font-size: 15px; margin: 0 0 12px; }
.board .count { color: var(--ink-2); font-weight: 400; }
.board section > p { margin: 0 0 4px; }
.types { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.types li { background: var(--panel); border-radius: 8px; box-shadow: var(--ring); }
.types a { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 44px; padding: 10px 16px; color: var(--ink); text-decoration: none; }
.types a:hover { background: var(--well); border-radius: 8px; }
.types .meta { font-size: 14px; }
.cards { list-style: none; margin: 0 0 8px; padding: 0; }
.cards li { background: var(--panel); border-radius: 8px; box-shadow: var(--ring); padding: 12px; margin: 0 0 8px; }
.cards h3 { font-size: 14px; margin: 0 0 6px; line-height: 20px; }
.cards p { margin: 0 0 6px; font-size: 13px; line-height: 20px; }
.cards p:last-child { margin: 0; }
.cards .badge { font-size: 12px; line-height: 18px; padding: 1px 8px; }
@media (max-width: 767px) {
  article { padding: 20px; }
  .top { flex-wrap: wrap; }
  .search { flex: 1 0 100%; margin: 0; order: 4; }
  .sections { flex: 1 0 100%; order: 3; }
  .sections a, .chips a { min-height: 44px; }
  .button, input[type="search"], select, .field.check { min-height: 44px; }
  input[type="search"], select { font-size: 16px; }
  .field { flex-basis: 40%; }
  .details > div { grid-template-columns: 1fr; gap: 0; }
}
@media (pointer: coarse) {
  .button, input[type="search"], select, .field.check { min-height: 44px; }
  input[type="search"], select { font-size: 16px; }
}
@media (prefers-reduced-motion: no-preference) { .button { transition: background-color 150ms; } }
@media (forced-colors: active) { .badge, .button, article, .chips a, .cards li, .types li { border: 1px solid; } }
`;
