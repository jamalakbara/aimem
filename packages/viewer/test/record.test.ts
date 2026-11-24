import { fileURLToPath } from "node:url";
import {
  type IndexedRecord,
  loadProject,
  loadProjectIndex,
  nodeFs,
  type ProjectIndex,
  sourceWarnings,
} from "@aimem/core";
import { parse, type DefaultTreeAdapterTypes as T } from "parse5";
import { beforeAll, describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/markdown.js";
import { MAX_PLAIN_CHARS, MAX_RENDER_CHARS, MAX_SAME_ID, recordPage } from "../src/pages/record.js";
import type { ViewContext } from "../src/view.js";

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../../fixtures/projects/${name}`, import.meta.url));

async function context(name: string, over: Partial<ViewContext> = {}): Promise<ViewContext> {
  const nb = await loadProject(nodeFs, fixture(name));
  const index = await loadProjectIndex(nb, { fs: nodeFs });
  return {
    nb,
    index,
    problems: index.problems,
    warnings: sourceWarnings(index),
    now: new Date("2026-11-24T00:00:00Z"),
    ...over,
  };
}

/** The fixture with some records replaced or added. */
function withRecords(ctx: ViewContext, ...records: IndexedRecord[]): ViewContext {
  const index: ProjectIndex = { ...ctx.index, records: [...ctx.index.records, ...records] };
  return { ...ctx, index };
}

function record(over: Partial<IndexedRecord> = {}): IndexedRecord {
  const base = {
    id: "mem-zzzzzzzz",
    type: "memory" as const,
    status: "active",
    trust: "verified",
    title: "Title",
    summary: "Summary",
    tags: [],
    roles: ["all"],
    paths: [],
    links: [],
    author: "human:dana",
    created: "2026-11-01T00:00:00Z",
    updated: "2026-11-02T00:00:00Z",
    fm: {},
    body: "Body text.",
    file: ".aimem/memory/mem-zzzzzzzz-title.md",
    text: "RAW FILE TEXT",
  };
  return { ...base, ...over } as IndexedRecord;
}

const nodeText = (n: T.Node): string =>
  n.nodeName === "#text" && "value" in n
    ? n.value
    : "childNodes" in n
      ? n.childNodes.map(nodeText).join("")
      : "";
function find(html: string, test: (e: T.Element) => boolean): T.Element[] {
  const out: T.Element[] = [];
  const walk = (n: T.Node): void => {
    if ("tagName" in n && test(n)) out.push(n);
    if ("childNodes" in n) for (const c of n.childNodes) walk(c);
  };
  walk(parse(html));
  return out;
}
const texts = (html: string, tag: string) =>
  find(html, (e) => e.tagName === tag).map((e) => nodeText(e).trim());
const attr = (e: T.Element | undefined, name: string) => e?.attrs.find((a) => a.name === name)?.value;
const all = (html: string) =>
  find(html, (e) => e.tagName === "main")
    .map(nodeText)
    .join(" ")
    .replace(/\s+/g, " ");

let medium: ViewContext;
let empty: ViewContext;
beforeAll(async () => {
  medium = await context("medium");
  empty = { ...medium, problems: [], index: { ...medium.index, records: [], problems: [] } };
});

describe("recordPage (24 §5.2)", () => {
  it("shows title, summary, body and the separate status, trust and freshness labels", () => {
    const page = recordPage(medium, "dec-094vmt9t");
    expect(page.status).toBe(200);
    expect(texts(page.html, "h1")).toEqual(["Use Zod 4 for schemas and JSON Schema export"]);
    expect(texts(page.html, "title")).toEqual(["Use Zod 4 for schemas and JSON Schema export · aimem"]);
    expect(texts(page.html, "h2")).toContain("Context");
    const main = all(page.html);
    for (const s of [
      "Decision",
      "Accepted",
      "Verified",
      "Verified on 11 Oct 2026",
      "dec-094vmt9t",
      "human:akbar",
      "11 Oct 2026",
    ])
      expect(main).toContain(s);
    expect(main).toContain("packages/schema/**");
  });

  it("links both ends of a supersede chain", () => {
    const newer = recordPage(medium, "dec-094vmt9t").html;
    expect(newer).toContain(`href="/p/${medium.nb.config.project}/r/dec-0b20v421"`);
    expect(all(newer)).toContain("Replaces");
    const older = recordPage(medium, "dec-0b20v421").html;
    expect(all(older)).toContain("This record was replaced.");
    expect(all(older)).toContain("Use Zod 4 for schemas and JSON Schema export");
  });

  it("survives a supersede cycle", () => {
    const a = record({ id: "dec-aaaaaaaa", type: "decision", fm: { supersedes: "dec-bbbbbbbb" } });
    const b = record({ id: "dec-bbbbbbbb", type: "decision", fm: { supersedes: "dec-aaaaaaaa" } });
    expect(recordPage(withRecords(empty, a, b), "dec-aaaaaaaa").status).toBe(200);
  });

  it.each([
    ["verified", "Verified"],
    ["agent", "Not verified: written by an agent"],
    ["inferred", "Not verified: inferred draft"],
    ["strange", "Not verified: strange"],
  ])("states trust %s in words", (trust, label) => {
    expect(all(recordPage(withRecords(empty, record({ trust })), "mem-zzzzzzzz").html)).toContain(label);
  });

  it("states stale and expired in words", () => {
    const stale = record({ created: "2020-01-01T00:00:00Z" });
    expect(all(recordPage(withRecords(empty, stale), "mem-zzzzzzzz").html)).toContain("May be out of date");
    const expired = record({ fm: { expires: "2026-01-01" } });
    expect(all(recordPage(withRecords(empty, expired), "mem-zzzzzzzz").html)).toContain("Expired");
  });

  it("escapes every value and never serves the raw file", () => {
    const x = "</title></pre>\"><script>alert(1)</script><img src=x onerror='alert(1)'>";
    const r = record({
      title: x,
      summary: x,
      status: x,
      trust: x,
      tags: [x],
      roles: [x],
      paths: [x],
      links: [x],
      author: x,
      repo: x,
      created: x,
      updated: x,
      notebook: x,
      file: x,
      body: x,
      fm: {
        verified: x,
        supersedes: x,
        superseded_by: x,
        evidence: [x],
        priority: x,
        assignee: x,
        severity: x,
        services: [x],
        managed_by: "external",
        source: { system: x, id: x, url: x, state: x, synced_at: x },
        external: [{ system: x, id: x, url: x }],
      },
    });
    const { html } = recordPage(
      withRecords({ ...empty, warnings: [x], stale: x, problems: [{ file: x, message: x }] }, r),
      "mem-zzzzzzzz",
    );
    expect(find(html, (e) => e.tagName === "img")).toEqual([]);
    expect(find(html, (e) => e.tagName === "script").map((e) => [attr(e, "src"), nodeText(e)])).toEqual([
      ["/assets/app.js", ""],
    ]);
    expect(find(html, (e) => e.attrs.some((a) => /^on|^style$/.test(a.name)))).toEqual([]);
    expect(find(html, (e) => /^(javascript|data):/i.test(attr(e, "href") ?? ""))).toEqual([]);
    expect(html).not.toContain("RAW FILE TEXT");
  });

  it.each([
    "dec-zzzzzzzz",
    "../../etc/passwd",
    "..\\..\\x",
    "/etc/passwd",
    "dec-094vmt9t/../x",
    "dec-094vmt9t\u0000",
    "DEC-094VMT9T",
    "constructor",
    "__proto__",
    "",
    "x".repeat(5000),
    "<script>",
    "other:dec-094vmt9t",
  ])("answers 404 without echoing %j", (ref) => {
    const page = recordPage(medium, ref);
    expect(page.status).toBe(404);
    expect(texts(page.html, "h1")).toEqual(["Record not found"]);
    if (ref.length > 3) expect(page.html).not.toContain(ref);
  });

  it("accepts this project's global ref", () => {
    expect(recordPage(medium, `${medium.nb.config.project}:dec-094vmt9t`).status).toBe(200);
  });

  it("shows both files when two records share an id", () => {
    const a = record({ title: "First" });
    const b = record({ title: "Second", file: ".aimem/memory/mem-zzzzzzzz-b.md" });
    const { html } = recordPage(withRecords(empty, a, b), "mem-zzzzzzzz");
    expect(texts(html, "h1")).toEqual(["2 records share mem-zzzzzzzz"]);
    expect(texts(html, "h2")).toEqual(expect.arrayContaining(["First", "Second"]));
  });

  it("names the notebook and says when a moved record is not checked out", () => {
    const hub = record({ notebook: "hub" });
    expect(all(recordPage(withRecords(empty, hub), "mem-zzzzzzzz").html)).toContain("hub");
    const stub = record({ fm: { moved_to: "repo:mobile" } });
    expect(all(recordPage(withRecords(empty, stub), "mem-zzzzzzzz").html)).toContain(
      "This record moved to repo:mobile, which is not available on this computer.",
    );
  });

  it("lists links with their trust and leaves unknown refs as text", () => {
    const target = record({ id: "mem-yyyyyyyy", title: "Target", trust: "inferred" });
    const r = record({ links: ["mem-yyyyyyyy", "mem-xxxxxxxx"] });
    const main = all(recordPage(withRecords(empty, r, target), "mem-zzzzzzzz").html);
    expect(main).toContain("Target");
    expect(main).toContain("Not verified: inferred draft");
    expect(main).toContain("mem-xxxxxxxx (not in this notebook)");
  });

  it("offers the body as plain text, escaped", () => {
    const r = record({ body: "**b** <i>" });
    const ctx = withRecords(empty, r);
    expect(
      find(recordPage(ctx, r.id).html, (e) => e.tagName === "a" && attr(e, "href") === "?view=plain"),
    ).toHaveLength(1);
    const plain = recordPage(ctx, r.id, { plain: true }).html;
    expect(texts(plain, "pre")).toEqual(["**b** <i>"]);
    expect(texts(plain, "strong")).toEqual([]);
  });

  it("shows large bodies as plain text and cuts very large ones", () => {
    const big = record({ body: "**x** ".repeat(MAX_RENDER_CHARS / 6 + 1) });
    const page = recordPage(withRecords(empty, big), big.id).html;
    expect(texts(page, "strong")).toEqual([]);
    expect(all(page)).toContain("too long to format");
    const huge = record({ body: "x".repeat(5_000_000) });
    const t = performance.now();
    const html = recordPage(withRecords(empty, huge), huge.id).html;
    expect(performance.now() - t).toBeLessThan(5000);
    expect(html.length).toBeLessThan(MAX_PLAIN_CHARS + 20_000);
    expect(all(html)).toContain("Only the first part is shown");
  });

  it("keeps the rest of the page when the body cannot be rendered", () => {
    const r = record({});
    const boom = () => {
      throw new Error("secret detail /home/x");
    };
    const { html, status } = recordPage(withRecords(empty, r), r.id, { render: boom });
    expect(status).toBe(200);
    expect(all(html)).toContain("This text could not be formatted.");
    expect(all(html)).toContain("Body text.");
    expect(html).not.toContain("secret detail");
    expect(texts(html, "h1")).toEqual(["Title"]);
  });

  it("shows source warnings and unreadable files", async () => {
    const multi = await context("multirepo/backend");
    const id = multi.index.records[0]?.id ?? "";
    expect(all(recordPage(multi, id).html)).toContain("not checked out");
    const broken = { ...medium, problems: [{ file: ".aimem/x.md", message: "bad <b>" }] };
    const main = all(recordPage(broken, "dec-094vmt9t").html);
    expect(main).toContain("1 file is not shown");
    expect(main).toContain(".aimem/x.md: bad <b>");
  });

  const badges = (html: string) =>
    find(html, (e) => e.tagName === "li" && /^badge\b/.test(attr(e, "class") ?? "")).map((e) => [
      nodeText(e),
      (attr(e, "class") ?? "").replace("badge", "").trim(),
    ]);

  it("puts the date next to Verified, and never for a record that is not verified", () => {
    const fm = { verified: "2026-11-01" };
    for (const [trust, label, kind] of [
      ["verified", "Verified on 1 Nov 2026", "ok"],
      ["agent", "Not verified: written by an agent", "warn"],
      ["inferred", "Not verified: inferred draft", "warn"],
      ["strange", "Not verified: strange", "warn"],
    ] as const) {
      const { html } = recordPage(withRecords(empty, record({ trust, fm })), "mem-zzzzzzzz");
      expect(badges(html)).toContainEqual([label, kind]);
      expect(texts(html, "dt"), trust).not.toContain("Verified");
      expect(all(html).includes("1 Nov 2026 "), trust).toBe(true); // created
      expect(badges(html).filter(([, k]) => k === "ok")).toHaveLength(trust === "verified" ? 1 : 0);
      if (trust !== "verified") expect(all(html)).not.toContain("Verified on");
    }
    expect(badges(recordPage(withRecords(empty, record()), "mem-zzzzzzzz").html)).toContainEqual([
      "Verified",
      "ok",
    ]);
  });

  it("shows freshness only when there is something to say", () => {
    expect(badges(recordPage(withRecords(empty, record()), "mem-zzzzzzzz").html)).toHaveLength(3);
    const old = record({ created: "2020-01-01T00:00:00Z" });
    expect(badges(recordPage(withRecords(empty, old), old.id).html)).toContainEqual([
      "May be out of date",
      "warn",
    ]);
  });

  it.each([
    ["upload", "Imported file"],
    ["google-doc", "Google Doc"],
    ["google-sheet", "Google Sheet"],
  ])("names the source %s before the body", (system, label) => {
    const source = { system, id: "x", url: "x", state: "missing", synced_at: "2026-11-01T00:00:00Z" };
    const r = record({ fm: { managed_by: "external", source } });
    const main = all(recordPage(withRecords(empty, r), r.id).html);
    expect(main.indexOf(`Source: ${label}`)).toBeGreaterThan(0);
    expect(main.indexOf(`Source: ${label}`)).toBeLessThan(main.indexOf("Body text."));
    expect(main).toContain("Last synced");
    expect(main).toContain("The source was missing");
    const own = record({ fm: { managed_by: "notebook", source } });
    expect(all(recordPage(withRecords(empty, own), own.id).html)).not.toContain("Source:");
  });

  it("formats up to the limit and not one character more", () => {
    const at = (n: number) => {
      const r = record({ body: `**b** ${"x".repeat(n - 6)}` });
      return texts(recordPage(withRecords(empty, r), r.id).html, "strong").length;
    };
    expect(at(MAX_RENDER_CHARS)).toBe(1);
    expect(at(MAX_RENDER_CHARS + 1)).toBe(0);
  });

  it("limits the whole page when many files share an id", () => {
    const body = "![".repeat(MAX_RENDER_CHARS / 2 - 1);
    const many = Array.from({ length: 40 }, (_, i) =>
      record({ body, file: `.aimem/memory/mem-zzzzzzzz-${i}.md` }),
    );
    let rendered = 0;
    const { html } = recordPage(withRecords(empty, ...many), "mem-zzzzzzzz", {
      render: (b, ctx) => {
        rendered += b.length;
        return renderMarkdown("", ctx);
      },
    });
    expect(rendered).toBeLessThanOrEqual(MAX_RENDER_CHARS);
    expect(find(html, (e) => e.tagName === "article")).toHaveLength(MAX_SAME_ID);
    expect(html.length).toBeLessThan(MAX_PLAIN_CHARS + 50_000);
    expect(all(html)).toContain("35 more records are not shown");
    const huge = many.map((r) => ({ ...r, body: "x".repeat(900_000) }));
    expect(recordPage(withRecords(empty, ...huge), "mem-zzzzzzzz").html.length).toBeLessThan(
      MAX_PLAIN_CHARS + 50_000,
    );
  });

  it("does not show characters that hide or reverse text", () => {
    const bad = "\u202E\u202D\u2066\u2069\u001B[2J\u0007\u007F\u009B\uFEFF\u{E0041}";
    const keep = "می\u200Cخواهم 👨\u200D👩";
    const mixed = `a${bad}b ${keep}`;
    const r = record({
      title: mixed,
      summary: mixed,
      body: `${mixed}\u2028[x${bad}](https://e.example/${bad}) \`${bad}\``,
    });
    for (const plain of [false, true]) {
      const { html } = recordPage({ ...withRecords(empty, r), warnings: [mixed] }, r.id, { plain });
      expect(html).not.toMatch(
        /[\u202A-\u202E\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}\u2028]|(?![\t\n])\p{Cc}/u,
      );
      expect(html).toContain(`ab`);
      expect(html).toContain(keep);
    }
  });

  it("says when the data may be old", () => {
    const main = all(recordPage({ ...medium, stale: "The viewer could not refresh." }, "dec-094vmt9t").html);
    expect(main).toContain("The viewer could not refresh.");
  });

  it("renders every record of the fixture", () => {
    for (const r of medium.index.records) {
      const page = recordPage(medium, r.id);
      expect(page.status, r.id).toBe(200);
      expect(texts(page.html, "h1")).toHaveLength(1);
    }
  });
});

describe("layout and error pages", () => {
  it("has a language, a skip link, one main, and only local assets", () => {
    const { html } = recordPage(medium, "dec-094vmt9t");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(attr(find(html, (e) => e.tagName === "html")[0], "lang")).toBe("en");
    expect(find(html, (e) => attr(e, "href") === "#main")).toHaveLength(1);
    expect(find(html, (e) => e.tagName === "main" && attr(e, "id") === "main")).toHaveLength(1);
    expect(find(html, (e) => e.tagName === "link").map((e) => attr(e, "href"))).toEqual([
      "/assets/style.css",
    ]);
    expect(all(html)).not.toContain("undefined");
    expect(texts(html, "header").join(" ")).toContain("Read-only");
  });

  it("hides Copy reference until the script shows it", () => {
    const button = find(recordPage(medium, "dec-094vmt9t").html, (e) => e.tagName === "button")[0];
    expect(attr(button, "hidden")).toBe("");
    expect(attr(button, "data-copy")).toBe("dec-094vmt9t");
  });
});
