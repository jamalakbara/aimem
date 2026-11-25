import { type IndexedRecord, type SearchOptions, search } from "@aimem/core";
import { RECORD_TYPES, STATUSES, TRUST_LEVELS } from "@aimem/schema";
import { beforeAll, describe, expect, it } from "vitest";
import { excerpt, searchPage } from "../src/pages/search.js";
import { MAX_QUERY, PAGE_SIZE, roleChoices } from "../src/query.js";
import type { ViewContext } from "../src/view.js";
import { all, attr, context, find, nodeText, record, texts, within, withRecords } from "./pages.js";

let medium: ViewContext;
let empty: ViewContext;
beforeAll(async () => {
  medium = await context("medium");
  empty = { ...medium, problems: [], index: { ...medium.index, records: [], problems: [] } };
});

const open = (c: ViewContext, params: Record<string, string> | string) =>
  searchPage(c, new URLSearchParams(params)).html;
/** The results as shown: [record id, title], in order. */
const hits = (html: string) =>
  find(html, (e) => e.tagName === "a" && /^r-(?!direct-)/.test(attr(e, "id") ?? "")).map((e) => [
    decodeURIComponent((attr(e, "href") ?? "").split("/").at(-1) ?? ""),
    nodeText(e),
  ]);
const link = (html: string, text: string) =>
  attr(find(html, (e) => e.tagName === "a" && nodeText(e).trim() === text)[0], "href");
/** Follows Next from the first page to the last. */
function everyPage(c: ViewContext, params: Record<string, string>): string[][] {
  const out: string[][] = [];
  let next: string | undefined = `?${new URLSearchParams(params)}`;
  for (let i = 0; next !== undefined && i < 500; i++) {
    const html = open(c, next.slice(next.indexOf("?")));
    const found = hits(html);
    expect(found.length).toBeLessThanOrEqual(PAGE_SIZE);
    out.push(...found);
    next = link(html, "Next");
  }
  return out;
}
const many = (n: number, over: (i: number) => Partial<IndexedRecord> = () => ({})) =>
  Array.from({ length: n }, (_, i) =>
    record({
      id: `mem-${String(i).padStart(8, "0")}`,
      title: `Zebra ${i}`,
      file: `.aimem/memory/mem-${i}.md`,
      ...over(i),
    }),
  );

describe("results equal search() (24 §5.3)", () => {
  const words = [
    "schema",
    "index retry",
    "task claim agent",
    "Use Zod 4",
    "decision",
    "über webhook",
    "a",
    "nothingmatches",
  ];
  const filters: Record<string, string>[] = [
    {},
    { closed: "1" },
    ...RECORD_TYPES.map((type) => ({ type })),
    ...RECORD_TYPES.map((type) => ({ type, closed: "1" })),
    ...["accepted", "superseded", "done", "active"].map((status) => ({ status })),
    ...TRUST_LEVELS.map((trust) => ({ trust, closed: "1" })),
    ...["dev", "qa", "pm"].map((role) => ({ role })),
    { type: "decision", status: "superseded", trust: "verified", role: "dev", closed: "1" },
  ];
  const expected = (c: ViewContext, q: string, f: Record<string, string>) => {
    const o: SearchOptions = {
      limit: Number.POSITIVE_INFINITY,
      ...(f.type ? { types: [f.type] } : {}),
      ...(f.status ? { statuses: [f.status] } : {}),
      // A role that no record has is not a choice, so it is ignored like any unknown value.
      ...(f.role && roleChoices(c.index.records).includes(f.role) ? { roles: [f.role] } : {}),
      ...(f.closed ? { includeSuperseded: true } : {}),
    };
    return search(c.index, q, o)
      .filter((h) => !f.trust || h.record.trust === f.trust)
      .map((h) => [h.record.id, h.record.title]);
  };

  it.each(["medium", "tiny", "multirepo/backend"])("%s: every query, filter and page", async (name) => {
    const c = await context(name);
    let seen = 0;
    for (const q of words)
      for (const f of filters) {
        const want = expected(c, q, f);
        seen += want.length;
        expect(everyPage(c, { q, ...f }), `${q} ${JSON.stringify(f)}`).toEqual(want);
      }
    expect(seen).toBeGreaterThan(0);
  });

  it("labels every result with its notebook", async () => {
    const c = await context("multirepo/backend");
    const other = [
      record({ id: "mem-aaaaaaaa", title: "Zebra", notebook: "hub" }),
      record({ id: "mem-bbbbbbbb", title: "Zebra", notebook: "repo:frontend" }),
      record({ id: "mem-cccccccc", title: "Zebra" }),
    ];
    const html = open(withRecords(c, ...other), { q: "zebra" });
    const shown = find(html, (e) => attr(e, "data-ref") !== undefined).map((li) => [
      attr(li, "data-ref"),
      within(li, (b) => attr(b, "class") === "badge")
        .map(nodeText)
        .slice(2),
    ]);
    expect(shown).toEqual([
      ["mem-aaaaaaaa", ["hub"]],
      ["mem-bbbbbbbb", ["repo:frontend"]],
      ["mem-cccccccc", []],
    ]);
  });

  it("keeps the order search() gives within a type, which differs from filtering afterwards", () => {
    const q = "webhook payment task claim session handoff token budget search";
    for (const type of RECORD_TYPES)
      expect(everyPage(medium, { q, type, closed: "1" })).toEqual(expected(medium, q, { type, closed: "1" }));
  });

  it("shows every record of a duplicate id, and moved records, with a hint", () => {
    const c = withRecords(
      empty,
      record({ title: "Zebra one", file: ".aimem/memory/one.md" }),
      record({ title: "Zebra two", file: ".aimem/memory/two.md" }),
      record({ id: "mem-yyyyyyyy", title: "Zebra moved", fm: { moved_to: "hub" } }),
    );
    const html = open(c, { q: "zebra" });
    expect(hits(html).map(([, title]) => title)).toEqual(
      expect.arrayContaining(["Zebra one", "Zebra two", "Zebra moved"]),
    );
    expect(all(html)).toContain(".aimem/memory/one.md");
    expect(all(html)).toContain(".aimem/memory/two.md");
    expect(all(html)).toContain("Moved to hub");
    const ids = find(html, (e) => attr(e, "id") !== undefined).map((e) => attr(e, "id"));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("an explicit status wins over Include closed", () => {
    const c = withRecords(
      empty,
      record({ status: "superseded", title: "Zebra" }),
      record({ id: "mem-yyyyyyyy", title: "Zebra" }),
    );
    expect(hits(open(c, { q: "zebra" })).map(([id]) => id)).toEqual(["mem-yyyyyyyy"]);
    expect(hits(open(c, { q: "zebra", closed: "1" }))).toHaveLength(2);
    expect(hits(open(c, { q: "zebra", status: "superseded" })).map(([id]) => id)).toEqual(["mem-zzzzzzzz"]);
    expect(hits(open(c, { q: "zebra", status: "active", closed: "1" })).map(([id]) => id)).toEqual([
      "mem-yyyyyyyy",
    ]);
  });
});

describe("pages", () => {
  it.each([0, 1, 24, 25, 26, 50, 51])("%i results", (n) => {
    const c = withRecords(empty, ...many(n));
    const found = everyPage(c, { q: "zebra" });
    expect(found).toHaveLength(n);
    expect(new Set(found.map(([id]) => id)).size).toBe(n);
    const first = open(c, { q: "zebra" });
    expect(link(first, "Previous")).toBeUndefined();
    if (n <= PAGE_SIZE) expect(link(first, "Next")).toBeUndefined();
    const range = `Showing 1–${PAGE_SIZE} of ${n}.`;
    if (n > PAGE_SIZE) expect(all(first)).toContain(range);
    else expect(all(first)).not.toContain("Showing");
  });

  it("reads page leniently and stays in range", () => {
    const c = withRecords(empty, ...many(51));
    const at = (page: string) =>
      /Showing (\d+)–(\d+) of 51/
        .exec(all(open(c, { q: "zebra", page })))
        ?.slice(1)
        .join();
    for (const bad of ["0", "-1", "1.5", "x", "", " 2", "1e1", "0x2", "NaN"])
      expect(at(bad), bad).toBe("1,25");
    expect(at("2")).toBe("26,50");
    expect(at("3")).toBe("51,51");
    for (const far of ["4", "999999999", "9".repeat(400)]) expect(at(far), far).toBe("51,51");
  });

  it("keeps every filter in the page links", () => {
    const c = withRecords(empty, ...many(60, () => ({ status: "stale", trust: "agent", roles: ["qa"] })));
    const f = {
      q: "zebra & co + 100%",
      type: "memory",
      status: "stale",
      trust: "agent",
      role: "qa",
      closed: "1",
    };
    const next = new URL(link(open(c, f), "Next") ?? "", "http://x");
    expect(Object.fromEntries(next.searchParams)).toEqual({ ...f, page: "2" });
    const back = new URL(link(open(c, next.search), "Previous") ?? "", "http://x");
    expect(Object.fromEntries(back.searchParams)).toEqual(f);
  });
});

describe("filters in the form", () => {
  const options = (html: string, name: string) =>
    find(html, (e) => e.tagName === "select" && attr(e, "name") === name).flatMap((e) =>
      within(e, (o) => o.tagName === "option"),
    );
  const values = (html: string, name: string) => options(html, name).map((o) => attr(o, "value"));
  const selected = (html: string, name: string) =>
    options(html, name)
      .filter((o) => attr(o, "selected") !== undefined)
      .map((o) => attr(o, "value"));

  it("is one form that works without the script", () => {
    const html = open(medium, { q: "schema", type: "decision" });
    const forms = find(html, (e) => e.tagName === "form");
    expect(forms).toHaveLength(1);
    expect(attr(forms[0], "method") ?? "get").toBe("get");
    expect(attr(forms[0], "action")).toBe(`/p/${medium.nb.config.project}/search`);
    const id = attr(forms[0], "id");
    const controls = find(html, (e) => attr(e, "name") !== undefined && e.tagName !== "meta");
    expect(controls.map((e) => attr(e, "name"))).toEqual(["q", "type", "status", "trust", "role", "closed"]);
    for (const e of controls.slice(1)) expect(attr(e, "form"), attr(e, "name")).toBe(id);
    expect(find(html, (e) => attr(e, "name") === "page")).toEqual([]);
    expect(attr(controls[0], "value")).toBe("schema");
    expect(attr(controls[0], "maxlength")).toBe(String(MAX_QUERY));
    // Every control has a name for screen readers.
    const labelled = find(html, (e) => e.tagName === "label").map((e) => attr(e, "for"));
    for (const e of controls.slice(1)) expect(labelled).toContain(attr(e, "id"));
    expect(selected(html, "type")).toEqual(["decision"]);
    expect(selected(html, "status")).toEqual([""]);
  });

  it("offers the types, statuses and trust levels of the schema, and the roles in use", () => {
    const html = open(medium, {});
    expect(values(html, "type")).toEqual(["", ...RECORD_TYPES]);
    expect(values(html, "status")).toEqual(["", ...new Set(Object.values(STATUSES).flat())]);
    expect(values(html, "trust")).toEqual(["", ...TRUST_LEVELS]);
    expect(values(html, "role")).toEqual(["", "analyst", "dev", "devops", "pm", "qa"]);
    const mixed = open(withRecords(empty, record({ roles: ["data_eng", "QA", "qa", "all"] })), {});
    expect(values(mixed, "role")).toEqual(["", "QA", "data_eng", "qa"]);
  });

  it("offers only short, plain roles, and not too many", () => {
    const odd = ["A B", "a".repeat(33), "<b>", "é", "all", ...Array.from({ length: 80 }, (_, i) => `r${i}`)];
    const html = open(withRecords(empty, record({ roles: odd })), {});
    const roles = find(html, (o) => o.tagName === "option" && /^r\d+$/.test(attr(o, "value") ?? ""));
    expect(roles).toHaveLength(50);
    for (const bad of odd.slice(0, 5))
      expect(find(html, (o) => o.tagName === "option" && attr(o, "value") === bad)).toEqual([]);
  });

  it("ignores unknown values and repeated parameters, and shows All", () => {
    const want = hits(open(medium, { q: "schema" }));
    const html = open(
      medium,
      "q=schema&q=other&type=x&type=decision&status=__proto__&trust=VERIFIED&role=nobody&closed=yes&zz=1",
    );
    expect(hits(html)).toEqual(want);
    for (const name of ["type", "status", "trust", "role"]) expect(selected(html, name), name).toEqual([""]);
    expect(html).not.toContain("__proto__");
    expect(html).not.toContain("nobody");
  });

  it("says so when a filter in the address is not one of the choices", () => {
    const note = "A filter in the address is not one of the choices, so it was ignored.";
    for (const p of ["type=x", "status=x", "trust=x", "role=nobody", "role=DEV", "type=decision&role=x"])
      expect(all(open(medium, `q=schema&${p}`)), p).toContain(note);
    for (const p of ["", "type=&status=&trust=&role=", "type=decision&role=dev", "zz=1", "page=x"])
      expect(all(open(medium, `q=schema&${p}`)), p).not.toContain(note);
  });

  it("finds roles with capitals and underscores, exactly as written", () => {
    const c = withRecords(
      empty,
      record({ id: "mem-aaaaaaaa", title: "Zebra", roles: ["QA"] }),
      record({ id: "mem-bbbbbbbb", title: "Zebra", roles: ["qa", "data_eng"] }),
    );
    const ids = (role: string) => hits(open(c, { q: "zebra", role })).map(([id]) => id);
    expect(ids("QA")).toEqual(["mem-aaaaaaaa"]);
    expect(ids("data_eng")).toEqual(["mem-bbbbbbbb"]);
  });

  it("the longest address a form can make stays under the limit of the guard", () => {
    const roles = ["x".repeat(32)];
    const c = withRecords(empty, record({ roles }));
    const longest = (values: string[]) => values.reduce((a, b) => (b.length > a.length ? b : a), "");
    const params = new URLSearchParams({
      q: "検".repeat(MAX_QUERY),
      type: longest([...RECORD_TYPES]),
      status: longest(Object.values(STATUSES).flat()),
      trust: longest([...TRUST_LEVELS]),
      role: roles[0] ?? "",
      closed: "1",
      page: "9999",
    });
    expect(`/p/${"x".repeat(60)}/search?${params}`.length).toBeLessThanOrEqual(2048);
    expect(open(c, params.toString())).toContain("x".repeat(32));
  });
});

describe("what the page says", () => {
  it("asks for a word when there is none, also with filters set", () => {
    for (const p of [{}, { q: "" }, { q: "  \t " }, { q: "", type: "decision" }] as Record<
      string,
      string
    >[]) {
      const html = open(medium, p);
      expect(hits(html)).toEqual([]);
      expect(all(html)).toContain("Type a word to search this notebook.");
      expect(texts(html, "h1")).toEqual(["Search"]);
    }
  });

  it("explains an empty result and offers to clear filters", () => {
    for (const q of ["nothingmatches", "a", "!!!", "&", "<script>"]) {
      const html = open(medium, { q });
      expect(texts(html, "h1"), q).toEqual([`0 results for “${q}”`]);
      expect(all(html)).toContain("No matching records");
      expect(all(html)).toContain("Search matches whole words. Try a different word or spelling.");
      expect(link(html, "Clear filters")).toBeUndefined();
    }
    const filtered = open(medium, { q: "schema", type: "testcase", status: "retired" });
    const clear = new URL(link(filtered, "Clear filters") ?? "", "http://x");
    expect(clear.pathname).toBe(`/p/${medium.nb.config.project}/search`);
    expect(Object.fromEntries(clear.searchParams)).toEqual({ q: "schema" });
  });

  it("says when the notebook is empty", () => {
    expect(all(open(empty, { q: "x1" }))).toContain("No records yet");
  });

  it("offers to clear Include closed on its own", () => {
    expect(link(open(medium, { q: "nothingmatches", closed: "1" }), "Clear filters")).toBeDefined();
  });

  it("keeps Include closed ticked, and only then", () => {
    const ticked = (p: Record<string, string>) =>
      find(open(medium, p), (e) => attr(e, "name") === "closed").map((e) => attr(e, "checked") !== undefined);
    expect(ticked({ q: "schema", closed: "1" })).toEqual([true]);
    expect(ticked({ q: "schema" })).toEqual([false]);
  });

  it("puts the count in the title, so a screen reader says it", () => {
    const c = withRecords(empty, ...many(1));
    expect(texts(open(c, { q: "zebra" }), "title")).toEqual(["1 result for “zebra” · aimem"]);
    expect(texts(open(withRecords(empty, ...many(30)), { q: "zebra", page: "2" }), "title")).toEqual([
      "30 results for “zebra”, page 2 · aimem",
    ]);
  });

  it("does not repeat the page in the heading", () => {
    expect(texts(open(withRecords(empty, ...many(30)), { q: "zebra", page: "2" }), "h1")).toEqual([
      "30 results for “zebra”",
    ]);
  });

  it("treats a pasted tab as a space, also before the query is cut", () => {
    const c = withRecords(empty, ...many(30));
    const html = open(c, { q: "zebra\tzebra" });
    expect(texts(html, "h1")).toEqual(["30 results for “zebra zebra”"]);
    expect(link(html, "Next")).not.toContain("%09");
    expect(html).not.toContain("\t");
    expect(hits(html)).toEqual(hits(open(c, { q: "zebra zebra" })));
    expect(all(open(c, { q: `zebra${"\t".repeat(MAX_QUERY - 5)}` }))).not.toContain("Only the first");
  });

  it("cuts a long query and says so", () => {
    const long = `zebra ${"x".repeat(MAX_QUERY)}`;
    const c = withRecords(empty, ...many(1));
    const html = open(c, { q: long });
    expect(hits(html)).toHaveLength(1);
    expect(all(html)).toContain("Only the first 200 characters were used.");
    expect(html).not.toContain("x".repeat(MAX_QUERY));
    expect(all(open(c, { q: long.slice(0, MAX_QUERY) }))).not.toContain("Only the first");
    const emoji = open(c, { q: `${"y".repeat(MAX_QUERY - 1)}😀` });
    expect(emoji).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("gives the direct link a place to come back to, apart from the results", () => {
    const ref = "dec-094vmt9t";
    const c = withRecords(medium, record({ title: `About ${ref}` }));
    const html = open(c, { q: ref });
    const direct = find(html, (e) => e.tagName === "a" && nodeText(e) === `Open ${ref}`)[0];
    expect(attr(direct, "id")).toBe(`r-direct-${ref}`);
    const ids = find(html, (e) => attr(e, "id") !== undefined).map((e) => attr(e, "id"));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("marks the search form and the page links for assistive technology", () => {
    const html = open(withRecords(empty, ...many(60)), { q: "zebra", page: "2" });
    expect(find(html, (e) => e.tagName === "form").map((e) => attr(e, "role"))).toEqual(["search"]);
    const rel = (t: string) =>
      find(html, (e) => e.tagName === "a" && nodeText(e) === t).map((e) => attr(e, "rel"));
    expect([rel("Previous"), rel("Next")]).toEqual([["prev"], ["next"]]);
  });

  it("offers to open a reference that exists, above the unchanged results", () => {
    const { project } = medium.nb.config;
    const ref = "dec-094vmt9t";
    for (const q of [ref, ` ${ref} `, `${project}:${ref}`]) {
      const html = open(medium, { q });
      expect(link(html, `Open ${ref}`), q).toBe(`/p/${project}/r/${ref}`);
      expect(hits(html)).toEqual(
        search(medium.index, q, { limit: Number.POSITIVE_INFINITY })
          .slice(0, PAGE_SIZE)
          .map((h) => [h.record.id, h.record.title]),
      );
    }
    for (const q of ["dec-zzzzzzzz", `other:${ref}`, `${ref} x`, "constructor"])
      expect(open(medium, { q }), q).not.toMatch(/>Open /);
  });

  it("says in every result how far it can be trusted, in words", () => {
    const c = withRecords(
      empty,
      record({ id: "mem-aaaaaaaa", title: "Zebra", trust: "verified", fm: { verified: "2026-11-01" } }),
      record({ id: "mem-bbbbbbbb", title: "Zebra", trust: "agent", fm: { verified: "2026-11-01" } }),
      record({ id: "mem-cccccccc", title: "Zebra Verified", trust: "inferred" }),
      record({ id: "mem-dddddddd", title: "Zebra", trust: "strange" }),
    );
    const html = open(c, { q: "zebra" });
    const labels = Object.fromEntries(
      find(html, (e) => attr(e, "data-ref") !== undefined).map((li) => [
        attr(li, "data-ref"),
        within(li, (b) => /^badge (ok|warn)$/.test(attr(b, "class") ?? "")).map((b) => [
          nodeText(b),
          attr(b, "class"),
        ]),
      ]),
    );
    expect(labels).toEqual({
      "mem-aaaaaaaa": [["Verified on 1 Nov 2026", "badge ok"]],
      "mem-bbbbbbbb": [["Not verified: written by an agent", "badge warn"]],
      "mem-cccccccc": [["Not verified: inferred draft", "badge warn"]],
      "mem-dddddddd": [["Not verified: strange", "badge warn"]],
    });
  });

  it("shows type, status, reference, notebook and summary", () => {
    const c = withRecords(
      empty,
      record({
        id: "tsk-zzzzzzzz",
        type: "task",
        status: "review",
        title: "Zebra",
        summary: "Short words.",
        notebook: "repo:api",
      }),
    );
    const main = all(open(c, { q: "zebra" }));
    for (const s of ["Task", "In review", "tsk-zzzzzzzz", "repo:api", "Short words."])
      expect(main).toContain(s);
  });

  it("escapes everything, wherever it comes from", () => {
    const x = `"><script>alert(1)</script><img src=x onerror='alert(1)'></title>`;
    const r = record({
      title: `zebra ${x}`,
      summary: x,
      body: `zebra ${x}`,
      status: x,
      trust: x,
      notebook: x,
      file: x,
      roles: [x],
      fm: { moved_to: x },
    });
    const c = withRecords({ ...empty, warnings: [x], stale: x, problems: [{ file: x, message: x }] }, r, {
      ...r,
    });
    for (const p of [
      { q: "zebra" },
      { q: x },
      { q: `zebra ${x}`, type: x, status: x, trust: x, role: x, closed: x, page: x },
    ] as Record<string, string>[]) {
      const html = open(c, p);
      expect(find(html, (e) => e.tagName === "img")).toEqual([]);
      expect(find(html, (e) => e.tagName === "script").map((e) => [attr(e, "src"), nodeText(e)])).toEqual([
        ["/assets/app.js", ""],
      ]);
      expect(find(html, (e) => e.attrs.some((a) => /^on|^style$/.test(a.name)))).toEqual([]);
      for (const e of find(html, (a) => attr(a, "href") !== undefined))
        expect(attr(e, "href")).toMatch(/^(#main$|\/(?!\/)[\x21-\x7e]*$)/);
    }
  });
});

describe("excerpt", () => {
  const terms = (...t: string[]) => new Set(t);
  it("shows the words around the first match", () => {
    expect(excerpt("one two zebra three", terms("zebra"))).toBe("one two zebra three");
    const long = `${"before ".repeat(50)}Zebra ${"after ".repeat(50)}`;
    const e = excerpt(long, terms("zebra")) ?? "";
    expect(e).toMatch(/^… (before )+Zebra (after )+…$/);
    expect(e.length).toBeLessThanOrEqual(240);
  });
  it("has nothing to show without a match, or when it is too far down", () => {
    expect(excerpt("", terms("zebra"))).toBeUndefined();
    expect(excerpt("zebras", terms("zebra"))).toBeUndefined();
    expect(excerpt(`${"x ".repeat(10_000)}zebra`, terms("zebra"))).toBeUndefined();
    expect(excerpt(`${"x ".repeat(9_990)}zebra`, terms("zebra"))).toContain("zebra");
  });
  it("matches like search(): case, accents and punctuation", () => {
    expect(excerpt("a (Über-Zebra), b", terms("uber"))).toContain("(Über-Zebra),");
  });
  it("stays short with very long words and whole characters", () => {
    for (const w of ["x".repeat(30_000), `${"y".repeat(99)}😀`.repeat(30), "😀".repeat(5000)]) {
      const e = excerpt(`${w} zebra ${w}`, terms("zebra"));
      if (e === undefined) continue;
      expect(e.length).toBeLessThanOrEqual(240);
      expect(e).toContain("zebra");
      expect(e).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
    expect((excerpt(`zebra-${"x".repeat(5000)}`, terms("zebra")) ?? "").length).toBeLessThanOrEqual(240);
  });
  it("stays short, with the match, between many words of medium length", () => {
    const w = `${"w".repeat(50)} `;
    const e = excerpt(`${w.repeat(40)}zebra ${w.repeat(40)}`, terms("zebra")) ?? "";
    expect(e.length).toBeLessThanOrEqual(240);
    expect(e.indexOf("zebra")).toBeLessThan(120);
  });
  it("leaves out Markdown signs that stand alone, and nothing else", () => {
    const body = "## Why\n\n- one **two** zebra\n> quote\n\n| a | b |\n|---|:-:|\n***\nC# a-b #1 -x";
    expect(excerpt(body, terms("zebra"))).toBe("Why one **two** zebra quote a b C# a-b #1 -x");
  });
  it("is plain text in the page", () => {
    const c = withRecords(
      empty,
      record({ title: "T", summary: "S", body: "**zebra** [a](https://e.example) <b>x</b>" }),
    );
    const html = open(c, { q: "zebra" });
    expect(all(html)).toContain("**zebra** [a](https://e.example) <b>x</b>");
    expect(find(html, (e) => ["strong", "b", "em"].includes(e.tagName))).toEqual([]);
  });
});
