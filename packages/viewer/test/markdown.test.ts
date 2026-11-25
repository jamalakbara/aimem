import { parseFragment, type DefaultTreeAdapterTypes as T } from "parse5";
import { describe, expect, it } from "vitest";
import { html, safeExternalHref } from "../src/html.js";
import { ALLOWED_ATTRS, ALLOWED_TAGS, renderMarkdown } from "../src/markdown.js";

const known = new Map([
  ["dec-094vmt9t", "/p/acme/r/dec-094vmt9t"],
  ["mem-0b20v421", "/p/acme/r/mem-0b20v421"],
]);
const render = (md: string) =>
  String(renderMarkdown(md, { project: "acme", recordHref: (id: string) => known.get(id) }));

interface Found {
  tag: string;
  attrs: Record<string, string>;
  text: string;
}
/** What a browser would build from the output: every element with its attributes. */
function elements(html: string): Found[] {
  const out: Found[] = [];
  const text = (n: T.Node): string =>
    "value" in n && n.nodeName === "#text"
      ? n.value
      : "childNodes" in n
        ? n.childNodes.map(text).join("")
        : "";
  const walk = (n: T.Node): void => {
    if ("tagName" in n)
      out.push({
        tag: n.tagName,
        attrs: Object.fromEntries(n.attrs.map((a) => [a.name, a.value])),
        text: text(n),
      });
    if ("childNodes" in n) for (const c of n.childNodes) walk(c);
  };
  walk(parseFragment(html));
  return out;
}

const XSS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "<svg onload=alert(1)><script>alert(1)</script></svg>",
  "<iframe src=javascript:alert(1)></iframe>",
  '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  "<style>*{display:none}</style>",
  '<a href="javascript:alert(1)" style="x">a</a>',
  "<!-- --><base href=//evil.example>",
  "[a](javascript:alert(1))",
  "[a](JaVaScRiPt:alert(1))",
  "[a](javascript&#58;alert(1))",
  "[a](java\tscript:alert(1))",
  "[a](\u0001javascript:alert(1))",
  "[a](<javascript:alert(1)>)",
  "[a](data:text/html;base64,PHNjcmlwdD4=)",
  "[a](vbscript:x)",
  "[a](file:///etc/passwd)",
  "[a](//evil.example)",
  "[a](\\\\evil.example)",
  "[a](/p/acme/r/../../etc)",
  "[a](../../etc/passwd)",
  "[a](#x)",
  "[a](https://user:pw@evil.example/)",
  '[a](https://e.example "\\"><script>alert(1)</script>")',
  "[a]: javascript:alert(1)\n\n[a]",
  "![x](https://evil.example/p.png)",
  "![x](data:image/png;base64,AA)",
  "![x](javascript:alert(1))",
  '![" onerror="alert(1)](https://e.example/x)',
  "[![x](https://e.example/a.png)](https://e.example/b)",
  '```js" onload="alert(1)\nx\n```',
  "```<script>\n</code></pre><script>alert(1)</script>\n```",
  "`</code><script>alert(1)</script>`",
  "|a|\n|:-:|\n|<script>alert(1)</script>|",
  '<https://evil.example/"onmouseover=alert(1)>',
  "<javascript:alert(1)>",
  "# <img src=x onerror=alert(1)>",
  "[[<script>alert(1)</script>]]",
  '[[dec-094vmt9t"><script>]]',
  "&lt;script&gt;alert(1)&lt;/script&gt;",
  "&#60;script&#62;alert(1)",
  "</div></main><script>alert(1)</script>",
  "\u2028<script>\u2029",
  "a\u0000<script>alert(1)</script>",
];

describe("renderMarkdown keeps to the allow-list (24 decision 2, 09 T5)", () => {
  it.each(XSS)("%j", (md) => {
    for (const e of elements(render(md))) {
      expect(ALLOWED_TAGS, e.tag).toContain(e.tag);
      for (const [name, value] of Object.entries(e.attrs)) {
        expect(ALLOWED_ATTRS[e.tag] ?? [], `${e.tag} ${name}`).toContain(name);
        if (name === "href") {
          const internal = [...known.values()].includes(value);
          if (!internal) expect(["https:", "http:", "mailto:"]).toContain(new URL(value).protocol);
        }
      }
    }
  });

  it("shows raw HTML as text", () => {
    expect(render("<b>x</b>")).toBe("<p>&lt;b&gt;x&lt;/b&gt;</p>\n");
  });

  it("keeps the label of a refused link and drops the link", () => {
    for (const href of ["javascript:alert(1)", "//evil.example", "../x", "#x", "https://u:p@e.example/"])
      expect(elements(render(`[label](${href})`)), href).toEqual([{ tag: "p", attrs: {}, text: "label" }]);
  });

  it("opens web links without passing the opener or referrer", () => {
    expect(render("[ok](https://e.example/a?b=1&c=2)")).toBe(
      '<p><a href="https://e.example/a?b=1&amp;c=2" rel="noopener noreferrer">ok</a></p>\n',
    );
    expect(render("[m](mailto:a@e.example)")).toContain('href="mailto:a@e.example"');
  });

  it("never loads an image; the address becomes a link", () => {
    expect(render("![plan](https://e.example/p.png)")).toBe(
      '<p><a href="https://e.example/p.png" rel="noopener noreferrer">Image: plan</a></p>\n',
    );
    expect(render("![plan](data:image/png;base64,AA)")).toBe("<p>Image: plan</p>\n");
    expect(render("![](https://e.example/p.png)")).toContain(">Image</a>");
  });

  it("never nests a link in a link", () => {
    const links = elements(render("[![x](https://e.example/a) dec-094vmt9t](https://e.example/b)")).filter(
      (e) => e.tag === "a",
    );
    expect(links).toEqual([
      {
        tag: "a",
        attrs: { href: "https://e.example/b", rel: "noopener noreferrer" },
        text: "Image: x dec-094vmt9t",
      },
    ]);
  });
});

describe("html helpers", () => {
  it("keeps a quote in an address inside its attribute", () => {
    const [a] = elements(String(html`<a href="${safeExternalHref('mailto:a"onclick="x')}">x</a>`));
    expect(Object.keys(a?.attrs ?? {})).toEqual(["href"]);
  });

  it("accepts only absolute web and mail addresses", () => {
    for (const bad of [
      "",
      "x",
      "/x",
      "//e.example",
      "javascript:x",
      "ftp://e.example",
      "https://u@e.example",
    ])
      expect(safeExternalHref(bad), bad).toBeUndefined();
    expect(safeExternalHref("HTTPS://E.example")).toBe("https://e.example/");
  });
});

describe("renderMarkdown output", () => {
  it("links known records, by id and by [[ref]], and leaves unknown ones as text", () => {
    const html = render(
      "See [[dec-094vmt9t]], mem-0b20v421, acme:dec-094vmt9t and dec-zzzzzzzz, other:dec-094vmt9t.",
    );
    const links = elements(html).filter((e) => e.tag === "a");
    expect(links.map((l) => [l.attrs.href, l.text])).toEqual([
      ["/p/acme/r/dec-094vmt9t", "dec-094vmt9t"],
      ["/p/acme/r/mem-0b20v421", "mem-0b20v421"],
      ["/p/acme/r/dec-094vmt9t", "acme:dec-094vmt9t"],
    ]);
    expect(html).toContain("dec-zzzzzzzz");
    expect(html).toContain("other:dec-094vmt9t");
    expect(render("[[dec-zzzzzzzz]]")).toBe("<p>[[dec-zzzzzzzz]]</p>\n");
    expect(elements(render("xdec-094vmt9t dec-094vmt9tx")).filter((e) => e.tag === "a")).toEqual([]);
  });

  it("does not link record ids inside code or longer paths", () => {
    expect(elements(render("`dec-094vmt9t` a/dec-094vmt9t-slug.md")).filter((e) => e.tag === "a")).toEqual(
      [],
    );
  });

  it("puts headings below the page title", () => {
    expect(render("# A\n\n###### B")).toBe("<h2>A</h2>\n<h6>B</h6>\n");
    expect(render("## A\n\n### B")).toBe("<h2>A</h2>\n<h3>B</h3>\n");
    const nested = renderMarkdown("## A", { project: "acme", recordHref: () => undefined, headingLevel: 3 });
    expect(String(nested)).toBe("<h3>A</h3>\n");
  });

  it("keeps the number an ordered list starts at", () => {
    expect(render("3. c\n4. d")).toContain('<ol start="3">');
    expect(render("1. a")).toContain("<ol>");
  });

  it("renders tight lists, tables, code and emphasis", () => {
    expect(render("- a\n- **b**")).toBe("<ul>\n<li>a</li>\n<li><strong>b</strong></li>\n</ul>\n");
    expect(render("|a|\n|-|\n|b|")).toContain('<th scope="col">a</th>');
    expect(render("```js\na<b\n```")).toBe('<pre tabindex="0"><code>a&lt;b\n</code></pre>\n');
    expect(render("*a* ~~b~~ `c`  \nd\ne")).toBe("<p><em>a</em> <s>b</s> <code>c</code><br>\nd\ne</p>\n");
    expect(render("> q\n\n---")).toBe("<blockquote>\n<p>q</p>\n</blockquote>\n<hr>\n");
  });

  it("renders 200 KB of hostile input in bounded time", () => {
    const n = 200_000;
    const fill = (s: string) => s.repeat(Math.ceil(n / s.length)).slice(0, n);
    for (const s of [
      ">",
      "*_",
      "[^a] ",
      "![",
      "[a](",
      "[[",
      "[[dec-",
      "dec-",
      "acme:",
      "a-",
      "|a",
      "<a ",
      "~~a ",
    ]) {
      const t = performance.now();
      render(fill(s));
      expect(performance.now() - t, s).toBeLessThan(10_000);
    }
  });
});
