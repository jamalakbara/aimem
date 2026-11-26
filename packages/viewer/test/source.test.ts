import type { IndexedRecord } from "@aimem/core";
import type { DefaultTreeAdapterTypes as T } from "parse5";
import { beforeAll, describe, expect, it } from "vitest";
import { dashboard } from "../src/pages/dashboard.js";
import { decisionsPage } from "../src/pages/decisions.js";
import { handoffsPage } from "../src/pages/handoffs.js";
import { importPage } from "../src/pages/import.js";
import { recordPage } from "../src/pages/record.js";
import { recordsPage } from "../src/pages/records.js";
import { searchPage } from "../src/pages/search.js";
import { tasksPage } from "../src/pages/tasks.js";
import { editLink, externalSource } from "../src/source.js";
import type { ViewContext } from "../src/view.js";
import { all, attr, cardsOf, context, find, nodeText, record, texts, within, withRecords } from "./pages.js";

let medium: ViewContext;
let empty: ViewContext;
beforeAll(async () => {
  medium = await context("medium");
  empty = { ...medium, problems: [], index: { ...medium.index, records: [], problems: [] } };
});

const P = "/p/aimem";
const DOC = "https://docs.google.com/document/d/abc123/edit";
const SHEET = "https://docs.google.com/spreadsheets/d/xyz/edit#gid=7";
const external = (source: Record<string, unknown>, over: Partial<IndexedRecord> = {}) =>
  record({
    id: "mem-zzzzzzzz",
    title: "Zebra",
    fm: {
      managed_by: "external",
      source: { system: "google-doc", id: "abc123", url: DOC, state: "ok", ...source },
    },
    ...over,
  });
const only = (...r: IndexedRecord[]) => withRecords(empty, ...r);
const page = (r: IndexedRecord) => recordPage(only(r), r.id).html;
const outside = (html: string) =>
  find(html, (e) => e.tagName === "a" && !/^(\/|#|\?)/.test(attr(e, "href") ?? ""));
const editLinks = (html: string) => find(html, (e) => e.tagName === "a" && nodeText(e) === "Edit at source");

describe("which address becomes Edit at source (24 §5.7)", () => {
  it.each([
    [DOC, DOC, "docs.google.com"],
    [SHEET, SHEET, "docs.google.com"],
    ["HTTPS://Docs.Google.com/x", "https://docs.google.com/x", "docs.google.com"],
    ["https://example.com:8443/a?b=1#c", "https://example.com:8443/a?b=1#c", "example.com:8443"],
    ["https://bücher.example/é", "https://xn--bcher-kva.example/%C3%A9", "xn--bcher-kva.example"],
    ["https://example.com/@team?to=a@b#@c", "https://example.com/@team?to=a@b#@c", "example.com"],
    ['https://example.com/"><script>', "https://example.com/%22%3E%3Cscript%3E", "example.com"],
  ])("links %j", (url, href, host) => {
    expect(editLink("google-doc", url)).toEqual({ href, host });
  });

  it.each([
    "http://docs.google.com/document/d/a/edit",
    "javascript:alert(1)",
    "JavaScript:alert(1)//https://x",
    "data:text/html,<script>alert(1)</script>",
    "file:docs/notes.md",
    "file:///etc/passwd",
    "mailto:a@example.com",
    "ftp://example.com/x",
    "vbscript:x",
    "//docs.google.com/x",
    "/p/aimem",
    "docs.google.com/x",
    "https:docs.google.com/x",
    "https:/docs.google.com/x",
    "https:\\\\docs.google.com\\x",
    " https://docs.google.com/x",
    "\nhttps://docs.google.com/x",
    "java\tscript:alert(1)",
    "ht\ttps://docs.google.com/x",
    "https://user:pass@docs.google.com/x",
    "https://user@docs.google.com/x",
    "https://:pass@docs.google.com/x",
    "https://docs.google.com@evil.example/x",
    "https://",
    "https://exa mple.com/",
    // What the parser would repair or drop: the link would not be what is written.
    "https:///docs.google.com/x",
    "https:////evil.example",
    "https://\\evil.example",
    "https://docs.google.com\\.evil.example/",
    "https://evil.example\\@docs.google.com/",
    "https://example.com/a\\b",
    "https://docs.go\togle.com/d/1",
    "https://docs.google.com\n.evil.example",
    "https://docs.google.com/d/1\n",
    "https://docs.google.com/d/1 ",
    "https://docs.google.com/d/1\u0000",
    "https://docs.google.com/d/1\u007f",
    "https://docs.google.com/d/1\u0085",
    "https://docs.google.com/a b",
    "https://docs.google.com/a\u00a0b",
    "https://docs.google.com/a\u2028b",
    // Credentials, also empty ones.
    "https://@docs.google.com/x",
    "https://:@docs.google.com/x",
    "",
  ])("does not link %j", (url) => {
    expect(editLink("google-doc", url)).toBeUndefined();
  });

  it.each([undefined, null, 3, ["https://example.com"], { href: "https://example.com" }, true])(
    "does not link a value that is not text: %j",
    (url) => {
      expect(editLink("google-doc", url)).toBeUndefined();
    },
  );

  it("links only systems where a document can be edited", () => {
    for (const system of ["google-doc", "google-sheet", "odoo"])
      expect(editLink(system, DOC), system).toBeDefined();
    for (const system of [
      "upload",
      "Google-Doc",
      "google-doc ",
      "dropbox",
      "constructor",
      "__proto__",
      "",
      undefined,
      3,
    ])
      expect(editLink(system, DOC), String(system)).toBeUndefined();
  });
});

describe("what a record says about its source (24 §5.7)", () => {
  it("names the system", () => {
    for (const [system, name] of [
      ["google-doc", "Google Doc"],
      ["google-sheet", "Google Sheet"],
      ["upload", "Imported file"],
      ["odoo", "Odoo"],
      ["other-thing", "other-thing"],
    ])
      expect(externalSource(external({ system }))?.name).toBe(name);
  });

  it("names the row of a record that came from a sheet", () => {
    const row = (system: string, at: unknown) => externalSource(external({ system, row: at }))?.row;
    expect(row("google-sheet", 12)).toBe("row 12");
    expect(row("upload", "3")).toBe("row 3");
    expect(row("google-sheet", "key:TC-7")).toBe("row with key TC-7");
    expect(row("upload", "key:TC-7")).toBe("row with key TC-7");
    for (const at of [undefined, "", "key:", "abc", 0, -1, 1.5, null, {}])
      expect(row("google-sheet", at), String(at)).toBeUndefined();
  });

  it("names no row for a source that is not a sheet, whatever the file says", () => {
    for (const system of ["google-doc", "odoo", "other-thing", "constructor"])
      for (const at of [12, "3", "key:TC-7"])
        expect(externalSource(external({ system, row: at }))?.row, `${system} ${at}`).toBeUndefined();
    const html = page(external({ system: "google-doc", row: 12 }));
    expect(all(html)).toContain("Source: Google Doc");
    expect(all(html)).not.toMatch(/row 12|Google Doc,/);
  });

  it("says nothing for a record the notebook owns, or without a usable source", () => {
    expect(externalSource(record())).toBeUndefined();
    const source = { system: "google-doc", url: DOC };
    for (const fm of [
      { source },
      { managed_by: "notebook", source },
      { managed_by: "external" },
      { managed_by: "external", source: DOC },
      { managed_by: "external", source: [source] },
      { managed_by: "external", source: { url: DOC } },
      { managed_by: "external", source: { system: 3, url: DOC } },
    ])
      expect(externalSource(record({ fm })), JSON.stringify(fm)).toBeUndefined();
  });
});

describe("the record page (24 §5.7)", () => {
  it("has Edit at source with the name of the source near it, and says where it leads", () => {
    const html = page(external({}));
    const [a] = editLinks(html);
    expect(editLinks(html)).toHaveLength(1);
    expect([attr(a, "href"), attr(a, "rel"), attr(a, "target")]).toEqual([
      DOC,
      "noopener noreferrer",
      undefined,
    ]);
    const text = all(html).replace(/\s+/g, " ");
    expect(text).toContain("Source: Google Doc");
    expect(text).toContain("Opens docs.google.com");
    expect(text.indexOf("Source: Google Doc")).toBeLessThan(text.indexOf("Edit at source"));
    expect(text.indexOf("Edit at source")).toBeLessThan(text.indexOf("Copy reference"));
    expect(outside(html)).toHaveLength(1);
  });

  it("shows the row of a sheet next to its name", () => {
    expect(all(page(external({ system: "google-sheet", url: SHEET, row: 12 })))).toContain(
      "Source: Google Sheet, row 12",
    );
  });

  it("shows the host of a look-alike, so it does not pass for Google", () => {
    const html = page(external({ url: "https://docs.google.com.evil.example/document" }));
    expect(all(html)).toContain("Opens docs.google.com.evil.example");
  });

  it("names an imported file without a way to edit it, even with a web address", () => {
    for (const url of ["file:docs/notes.md", DOC]) {
      const html = page(external({ system: "upload", url }));
      expect(all(html)).toContain("Source: Imported file");
      expect(editLinks(html)).toEqual([]);
      expect(outside(html)).toEqual([]);
      expect(all(html)).not.toContain("Opens ");
    }
  });

  it("keeps the name but no link when the address is not allowed, and never shows the address", () => {
    const html = page(external({ url: "http://docs.google.com/secret-path" }));
    expect(all(html)).toContain("Source: Google Doc");
    expect(editLinks(html)).toEqual([]);
    expect(html).not.toContain("secret-path");
  });

  it("keeps the link and the note about a source that was missing", () => {
    const html = page(external({ state: "missing" }));
    expect(editLinks(html)).toHaveLength(1);
    expect(all(html)).toContain("The source was missing or could not be read at the last sync.");
  });

  it("has neither for a record the notebook owns", () => {
    for (const html of [page(record({ id: "mem-zzzzzzzz" })), recordPage(medium, "dec-094vmt9t").html]) {
      expect(editLinks(html)).toEqual([]);
      expect(all(html)).not.toContain("Source:");
    }
  });

  it("gives each of two files with one id its own source", () => {
    const html = recordPage(
      only(
        external({}),
        external({ system: "upload", url: "file:x.md" }, { file: ".aimem/memory/other.md" }),
      ),
      "mem-zzzzzzzz",
    ).html;
    expect(editLinks(html)).toHaveLength(1);
    expect(all(html)).toContain("Source: Google Doc");
    expect(all(html)).toContain("Source: Imported file");
  });

  it("does not take the link from the body or other fields", () => {
    const r = external({ url: "javascript:alert(1)" }, { body: "text" });
    r.fm.url = DOC;
    r.fm.external = [{ system: "odoo", id: "1", url: DOC }];
    expect(editLinks(page(r))).toEqual([]);
  });
});

describe("every list names the source (24 §5.7)", () => {
  const of = (type: "task" | "decision" | "handoff" | "incident" | "memory", id: string, status: string) =>
    external({ system: "google-sheet", url: SHEET }, { id, type, status, title: "Zebra" });
  const c = () =>
    only(
      of("task", "tsk-00000001", "review"),
      of("decision", "dec-00000001", "accepted"),
      of("handoff", "hnd-00000001", "final"),
      of("incident", "inc-00000001", "resolved"),
      record({ id: "mem-00000002", title: "Zebra plain" }),
    );
  const q = (v: Record<string, string> = {}) => new URLSearchParams(v);
  const pages = (): [string, string, number][] => [
    ["board", tasksPage(c(), q()).html, 1],
    ["task list", tasksPage(c(), q({ status: "review" })).html, 1],
    ["decisions", decisionsPage(c(), q()).html, 1],
    ["handoffs", handoffsPage(c(), q()).html, 1],
    ["incidents", recordsPage(c(), q({ type: "incident" })).html, 1],
    ["search", searchPage(c(), q({ q: "zebra" })).html, 4],
    ["dashboard", dashboard(c()), 3],
  ];

  it("on every card of an external record, as text without a link out", () => {
    for (const [name, html, n] of pages()) {
      const cards = cardsOf(find(html, (e) => e.tagName === "main")[0] as T.Node);
      const labelled = cards.filter((e) => nodeText(e).includes("Source: Google Sheet"));
      expect(labelled.length, name).toBe(n);
      expect(outside(html), name).toEqual([]);
      expect(editLinks(html), name).toEqual([]);
    }
  });

  it("not on a record the notebook owns", () => {
    const html = recordsPage(only(record()), q({ type: "memory" })).html;
    expect(cardsOf(find(html, (e) => e.tagName === "main")[0] as T.Node)).toHaveLength(1);
    expect(all(html)).not.toContain("Source:");
  });

  it("escapes every field of a source, on every page", () => {
    const x = `"><script>alert(1)</script><img src=x onerror='alert(1)'></title>`;
    const urls = [
      x,
      `javascript:${x}`,
      `https://example.com/${x}`,
      `https://${x}`,
      `https://example.com/?q=${x}#${x}`,
    ];
    for (const [i, url] of urls.entries())
      for (const system of [x, "google-doc", "upload"]) {
        const fields = {
          system,
          url,
          row: x,
          id: x,
          version: x,
          state: x,
          synced_at: x,
          imported_by: x,
          content_sha: x,
        };
        const rs = [
          external(fields, { id: "tsk-00000001", type: "task", status: "review" }),
          external(
            { ...fields, row: `key:${x}` },
            { id: "dec-00000001", type: "decision", status: "accepted" },
          ),
          external(fields, { id: "hnd-00000001", type: "handoff", status: "final" }),
        ];
        const cx = only(...rs);
        const htmls = [
          ...rs.map((r) => recordPage(cx, r.id).html),
          tasksPage(cx, q()).html,
          decisionsPage(cx, q()).html,
          handoffsPage(cx, q()).html,
          searchPage(cx, q({ q: "zebra" })).html,
          dashboard(cx),
        ];
        for (const html of htmls) {
          expect(
            find(html, (e) => e.tagName === "img"),
            `${i} ${system}`,
          ).toEqual([]);
          expect(find(html, (e) => e.tagName === "script").map((e) => [attr(e, "src"), nodeText(e)])).toEqual(
            [["/assets/app.js", ""]],
          );
          expect(find(html, (e) => e.attrs.some((a) => /^on|^style$/.test(a.name)))).toEqual([]);
          for (const e of find(html, (a) => attr(a, "href") !== undefined))
            expect(attr(e, "href")).toMatch(
              /^(#main$|\/(?!\/)[\x21-\x7e]*$|\?[\x21-\x7e]*$|https:\/\/example\.com\/[\x21-\x7e]*$)/,
            );
          for (const e of outside(html)) {
            expect(nodeText(e)).toBe("Edit at source");
            expect(attr(e, "rel")).toBe("noopener noreferrer");
          }
        }
      }
  });
});

describe("the import guide (24 §5.7, decision 3)", () => {
  const html = () => importPage(medium);

  it("is a page of the notebook that explains import and sources", () => {
    expect(texts(html(), "h1")).toEqual(["Import documents"]);
    const text = all(html()).replace(/\s+/g, " ");
    for (const s of [
      "aimem import",
      "aimem sources add google",
      "aimem sources sync",
      "aimem detach",
      "read-only",
    ])
      expect(text).toContain(s);
    expect(text).toContain("Imported content is visible to everyone who can read this repository.");
    expect(text).toContain("A person does this, not an agent.");
  });

  it("cannot upload or send anything", () => {
    const [main] = find(html(), (e) => e.tagName === "main");
    expect(
      within(main as T.Node, (e) =>
        ["form", "input", "button", "select", "textarea", "iframe"].includes(e.tagName),
      ),
    ).toEqual([]);
    expect(find(html(), (e) => e.tagName === "script").map((e) => attr(e, "src"))).toEqual([
      "/assets/app.js",
    ]);
    expect(find(html(), (e) => e.tagName === "form")).toHaveLength(1);
    expect(outside(html())).toEqual([]);
  });

  it("is linked from the dashboard, also an empty one, and from Browse", () => {
    for (const h of [dashboard(medium), dashboard(empty), recordsPage(medium, new URLSearchParams()).html]) {
      const links = find(h, (e) => e.tagName === "a" && nodeText(e) === "How to import documents");
      expect(links.map((e) => attr(e, "href"))).toEqual([`${P}/import`]);
    }
    expect(dashboard({ ...medium, lens: "qa" })).toContain(`href="${P}/import?lens=qa"`);
  });

  it("keeps the header as it is, with no page marked", () => {
    const [nav] = find(html(), (e) => e.tagName === "nav" && attr(e, "aria-label") === "Sections");
    const links = within(nav as T.Node, (e) => e.tagName === "a");
    expect(links.map((e) => [nodeText(e), attr(e, "aria-current")])).toEqual([
      ["Tasks", undefined],
      ["Decisions", undefined],
      ["Handoffs", undefined],
      ["Browse", undefined],
    ]);
  });
});
