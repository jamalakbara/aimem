/** The one stylesheet, served as a constant. Roles: ground, panel, ink steps, line; system fonts; light and dark. */
export const STYLE = `
:root {
  color-scheme: light dark;
  --ground: #f9f9f8; --panel: #fff; --well: #f1f0ef; --line: #dad9d6;
  --ink: #21201c; --ink-2: #63635e; --link: #0d5cab; --focus: #21201c;
  --ok-bg: #e6f6eb; --ok: #18613a; --warn-bg: #fff7c2; --warn: #7a5200;
  --ring: 0 0 0 1px rgb(33 32 28 / .08), 0 1px 2px 0 rgb(33 32 28 / .12);
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ground: #080807; --panel: #191918; --well: #222221; --line: #3b3a37;
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
.empty { text-align: center; padding: 48px 24px; }
@media (max-width: 767px) {
  article { padding: 20px; }
  .button { min-height: 44px; }
  .details > div { grid-template-columns: 1fr; gap: 0; }
}
@media (pointer: coarse) { .button { min-height: 44px; } }
@media (prefers-reduced-motion: no-preference) { .button { transition: background-color 150ms; } }
@media (forced-colors: active) { .badge, .button, article { border: 1px solid; } }
`;
