import { filterRecords, type IndexedRecord, summarizeNotebook } from "@aimem/core";
import { RECORD_TYPES, STATUSES } from "@aimem/schema";
import { beforeAll, describe, expect, it } from "vitest";
import { STYLE } from "../src/assets/style.js";
import { dashboard, LATEST_HANDOFFS, RECENT_DECISIONS, REVIEW_CARDS } from "../src/pages/dashboard.js";
import { decisionsPage } from "../src/pages/decisions.js";
import { handoffsPage } from "../src/pages/handoffs.js";
import { recordsPage } from "../src/pages/records.js";
import { tasksPage } from "../src/pages/tasks.js";
import { lensChoices, readLens } from "../src/query.js";
import { type Page, shown, type ViewContext } from "../src/view.js";
import { all, attr, context, find, nodeText, record, refsOf, texts, within, withRecords } from "./pages.js";

let medium: ViewContext;
let tiny: ViewContext;
let multi: ViewContext;
let empty: ViewContext;
beforeAll(async () => {
  medium = await context("medium");
  tiny = await context("tiny");
  multi = await context("multirepo/backend");
  empty = { ...medium, problems: [], index: { ...medium.index, records: [], problems: [] } };
});

type View = (c: ViewContext, p: URLSearchParams) => Page;
const LISTS: Record<string, View> = {
  tasks: tasksPage,
  decisions: decisionsPage,
  handoffs: handoffsPage,
  records: recordsPage,
};
const lensed = (c: ViewContext, lens: string): ViewContext => ({ ...c, lens });
/** As the server reads the lens of an address. */
function withLens(c: ViewContext, params: URLSearchParams): ViewContext {
  const l = readLens(params, lensChoices(c.nb, c.index.records));
  return { ...c, ...(l.value ? { lens: l.value } : {}), lensIgnored: l.unknown };
}
/** The page at an address of the viewer, as the server would route it (dashboard and the four lists). */
function open(c: ViewContext, href: string): string {
  const url = new URL(href, "http://x");
  const [, , , section] = url.pathname.split("/");
  const ctx = withLens(c, url.searchParams);
  if (section === undefined) return dashboard(ctx);
  const view = LISTS[section];
  if (!view) throw new Error(`not a list: ${href}`);
  return view(ctx, url.searchParams).html;
}
const link = (html: string, text: string) =>
  attr(find(html, (e) => e.tagName === "a" && nodeText(e).trim() === text)[0], "href");
/** Every card of a list, following Next. */
function everyPage(c: ViewContext, href: string): string[] {
  const out: string[] = [];
  let next: string | undefined = href;
  for (let i = 0; next !== undefined && i < 500; i++) {
    const html = open(c, next);
    const main = find(html, (e) => e.tagName === "main")[0];
    out.push(...(main ? refsOf(main) : []));
    next = link(html, "Next");
  }
  return out;
}
const sorted = (a: string[]) => [...a].sort();
const rule = (c: ViewContext, lens: string) =>
  filterRecords(c.index.records as IndexedRecord[], { roles: [lens], includeSuperseded: true });

describe("the role lens equals filterRecords({ roles }) with every status (24 §5.6)", () => {
  it.each(["medium", "tiny", "multirepo/backend"])("%s: every role, list and status", (name) => {
    const c = name === "medium" ? medium : name === "tiny" ? tiny : multi;
    const P = `/p/${c.nb.config.project}`;
    for (const lens of lensChoices(c.nb, c.index.records)) {
      const pop = rule(c, lens);
      const of = (type: string, status?: string) =>
        sorted(
          pop
            .filter((r) => r.type === type && (status === undefined || r.status === status))
            .map((r) => r.id),
        );
      for (const status of [undefined, ...STATUSES.task])
        expect(
          sorted(everyPage(c, `${P}/tasks?status=${status ?? "x"}&lens=${lens}`)).length,
        ).toBeGreaterThanOrEqual(0);
      for (const status of STATUSES.task)
        expect(sorted(everyPage(c, `${P}/tasks?status=${status}&lens=${lens}`)), `${lens} ${status}`).toEqual(
          of("task", status),
        );
      expect(sorted(everyPage(c, `${P}/decisions?lens=${lens}`)), `${lens} decisions`).toEqual(
        of("decision"),
      );
      expect(sorted(everyPage(c, `${P}/handoffs?lens=${lens}`)), `${lens} handoffs`).toEqual(of("handoff"));
      for (const type of RECORD_TYPES.filter((t) => !["task", "decision", "handoff"].includes(t)))
        expect(sorted(everyPage(c, `${P}/records?type=${type}&lens=${lens}`)), `${lens} ${type}`).toEqual(
          of(type),
        );
    }
  });

  it("keeps finished and replaced records, which search would hide", () => {
    const c = withRecords(
      empty,
      record({ id: "tsk-aaaaaaaa", type: "task", status: "done", roles: ["qa"], file: "a.md" }),
      record({ id: "dec-aaaaaaaa", type: "decision", status: "superseded", roles: ["qa"], file: "b.md" }),
      record({ id: "dec-bbbbbbbb", type: "decision", status: "rejected", roles: ["dev"], file: "c.md" }),
      record({ id: "dec-cccccccc", type: "decision", status: "accepted", roles: ["all"], file: "d.md" }),
    );
    expect(everyPage(c, "/p/aimem/tasks?status=done&lens=qa")).toEqual(["tsk-aaaaaaaa"]);
    expect(sorted(everyPage(c, "/p/aimem/decisions?lens=qa"))).toEqual(["dec-aaaaaaaa", "dec-cccccccc"]);
    expect(sorted(everyPage(c, "/p/aimem/decisions"))).toEqual([
      "dec-aaaaaaaa",
      "dec-bbbbbbbb",
      "dec-cccccccc",
    ]);
  });

  it("changes nothing without a lens", () => {
    expect(shown(medium)).toBe(medium.index.records);
    for (const href of ["/p/aimem/tasks", "/p/aimem/decisions", "/p/aimem/records?type=memory"])
      expect(open(medium, href)).toBe(open(medium, `${href}${href.includes("?") ? "&" : "?"}lens=`));
  });

  it("links the record that replaced a decision, also when the lens leaves that record out", () => {
    const c = withRecords(
      empty,
      record({
        id: "dec-aaaaaaaa",
        type: "decision",
        status: "superseded",
        roles: ["qa"],
        title: "Old",
        fm: { superseded_by: "dec-bbbbbbbb" },
      }),
      record({
        id: "dec-bbbbbbbb",
        type: "decision",
        status: "accepted",
        roles: ["dev"],
        title: "New",
        fm: { supersedes: "dec-aaaaaaaa" },
      }),
    );
    const html = open(c, "/p/aimem/decisions?lens=qa");
    expect(link(html, "New")).toBe("/p/aimem/r/dec-bbbbbbbb");
    expect(all(html)).not.toContain("not in this notebook");
  });

  it("still shows the file of an id that two records share when the lens hides one of them", () => {
    const c = withRecords(
      empty,
      record({ roles: ["qa"], file: ".aimem/memory/one.md" }),
      record({ roles: ["dev"], file: ".aimem/memory/two.md" }),
    );
    expect(all(open(c, "/p/aimem/records?type=memory&lens=qa"))).toContain(".aimem/memory/one.md");
  });
});

describe("which roles a lens can be", () => {
  const nb = (roles: unknown) =>
    ({ ...medium.nb, config: { ...medium.nb.config, roles } }) as ViewContext["nb"];
  it("offers the roles of project.yaml in their order, then those of records, without all", () => {
    const recs = [record({ roles: ["zeta", "all", "qa", "data_eng", "QA"] })];
    expect(lensChoices(nb(["dev", "pm", "qa", "db"]), recs)).toEqual([
      "dev",
      "pm",
      "qa",
      "db",
      "QA",
      "data_eng",
      "zeta",
    ]);
    expect(lensChoices(nb(undefined), recs)).toEqual(["QA", "data_eng", "qa", "zeta"]);
    expect(lensChoices(nb(["all", "<b>", "x".repeat(33), "ok"]), [])).toEqual(["ok"]);
    const many = Array.from({ length: 80 }, (_, i) => `r${String(i).padStart(2, "0")}`);
    expect(lensChoices(nb(many), [])).toHaveLength(50);
  });

  it("reads an address: empty and all mean no lens, anything unknown is reported and not used", () => {
    const choices = ["qa", "QA", "dev"];
    const read = (q: string) => readLens(new URLSearchParams(q), choices);
    expect(read("")).toEqual({ unknown: false });
    expect(read("lens=")).toEqual({ unknown: false });
    expect(read("lens=qa")).toEqual({ value: "qa", unknown: false });
    expect(read("lens=QA")).toEqual({ value: "QA", unknown: false });
    expect(read("lens=Qa")).toEqual({ unknown: true });
    expect(read("lens=all")).toEqual({ unknown: true });
    expect(read("lens=%3Cscript%3E")).toEqual({ unknown: true });
    expect(read("lens=dev&lens=qa")).toEqual({ value: "dev", unknown: false });
    expect(read("lens=x&lens=qa")).toEqual({ unknown: true });
  });
});

describe("pages with a lens", () => {
  const P = "/p/aimem";
  const internal = (html: string) =>
    find(html, (e) => e.tagName === "a" && (attr(e, "href") ?? "").startsWith("/")).map(
      (e) => attr(e, "href") ?? "",
    );

  it("keep the lens in every link to a list or the dashboard, and not in links to records", () => {
    for (const href of [
      `${P}?lens=qa`,
      `${P}/tasks?lens=qa`,
      `${P}/tasks?status=open&lens=qa`,
      `${P}/decisions?lens=qa`,
      `${P}/decisions?status=accepted&lens=qa`,
      `${P}/handoffs?lens=qa`,
      `${P}/records?lens=qa`,
      `${P}/records?type=memory&lens=qa`,
    ]) {
      const html = open(medium, href);
      const links = internal(html);
      expect(links.length, href).toBeGreaterThan(3);
      for (const l of links) {
        const u = new URL(l, "http://x");
        const toRecord = /^\/p\/[^/]+\/r\//.test(u.pathname);
        const clears =
          u.searchParams.get("lens") === null &&
          find(html, (e) => attr(e, "href") === l && nodeText(e) === "Show all roles").length > 0;
        if (toRecord || clears) expect(u.searchParams.has("lens"), `${href}: ${l}`).toBe(false);
        else expect(u.searchParams.get("lens"), `${href}: ${l}`).toBe("qa");
      }
    }
  });

  it("follow Next and Previous with the lens", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      record({ id: `mem-${String(i).padStart(8, "0")}`, roles: ["qa"], file: `m${i}.md` }),
    );
    const c = withRecords(empty, ...many, record({ id: "mem-zzzzzzzz", roles: ["dev"], file: "z.md" }));
    expect(everyPage(c, `${P}/records?type=memory&lens=qa`)).toHaveLength(30);
    expect(link(open(c, `${P}/records?type=memory&lens=qa`), "Next")).toBe(
      `${P}/records?type=memory&page=2&lens=qa`,
    );
  });

  it("say which role is shown, and offer to show all roles at the same place", () => {
    const html = open(medium, `${P}/tasks?status=open&lens=qa`);
    expect(all(html)).toContain("Role: qa");
    expect(link(html, "Show all roles")).toBe(`${P}/tasks?status=open`);
    expect(texts(html, "title")[0]).toMatch(/ · qa · aimem$/);
    expect(link(open(medium, `${P}/records?type=memory&lens=qa`), "Show all roles")).toBe(
      `${P}/records?type=memory`,
    );
    expect(all(open(medium, `${P}/tasks?status=open`))).not.toContain("Role:");
  });

  it("report an unknown lens once, and show everything", () => {
    for (const lens of ["all", "nobody", "QAx", "%3Cb%3E"]) {
      const html = open(medium, `${P}/tasks?lens=${lens}`);
      const notes = find(html, (e) => attr(e, "class") === "note").map(nodeText);
      expect(notes, lens).toEqual(["A filter in the address is not one of the choices, so it was ignored."]);
      expect(html).not.toContain("nobody");
      expect(all(html)).not.toContain("Role:");
    }
    const both = open(medium, `${P}/tasks?status=x&lens=nobody`);
    expect(find(both, (e) => attr(e, "class") === "note")).toHaveLength(1);
  });

  it("report an unknown lens on every page that a lens narrows", () => {
    for (const href of [
      `${P}?lens=nobody`,
      `${P}/decisions?lens=nobody`,
      `${P}/handoffs?lens=all`,
      `${P}/records?lens=x`,
      `${P}/records?type=memory&lens=x`,
    ]) {
      const notes = find(open(medium, href), (e) => attr(e, "class") === "note").map(nodeText);
      expect(notes, href).toEqual(["A filter in the address is not one of the choices, so it was ignored."]);
    }
  });

  it("keep the lens in the links of the dashboard for every role", () => {
    for (const lens of lensChoices(medium.nb, medium.index.records)) {
      const html = open(medium, `${P}?lens=${lens}`);
      for (const l of internal(html).filter((h) => !/\/r\//.test(h)))
        expect(new URL(l, "http://x").searchParams.get("lens"), `${lens}: ${l}`).toBe(lens);
    }
    const c = withRecords(
      empty,
      record({ id: "tsk-aaaaaaaa", type: "task", status: "review", roles: ["qa"] }),
    );
    expect(link(open(c, `${P}?lens=qa`), "View 1 task in review")).toBe(`${P}/tasks?status=review&lens=qa`);
  });

  it("name the file of a shared id on the dashboard, also when the lens hides the other file", () => {
    const c = withRecords(
      empty,
      record({
        id: "dec-aaaaaaaa",
        type: "decision",
        status: "accepted",
        roles: ["qa"],
        file: ".aimem/decisions/one.md",
      }),
      record({
        id: "dec-aaaaaaaa",
        type: "decision",
        status: "accepted",
        roles: ["dev"],
        file: ".aimem/decisions/two.md",
      }),
    );
    expect(all(open(c, `${P}?lens=qa`))).toContain(".aimem/decisions/one.md");
  });

  it("keep the lens in Clear filters on an empty status", () => {
    const inc = withRecords(
      empty,
      record({ id: "inc-aaaaaaaa", type: "incident", status: "resolved", roles: ["qa"] }),
    );
    const html = open(inc, `${P}/records?type=incident&status=investigating&lens=qa`);
    expect(link(html, "Clear filters")).toBe(`${P}/records?type=incident&lens=qa`);
    const tasks = open(
      withRecords(empty, record({ id: "tsk-aaaaaaaa", type: "task", status: "open", roles: ["qa"] })),
      `${P}/tasks?status=done&lens=qa`,
    );
    expect(link(tasks, "Clear filters")).toBe(`${P}/tasks?lens=qa`);
  });

  it("have one search form, without the lens", () => {
    for (const href of [`${P}?lens=qa`, `${P}/tasks?lens=qa`]) {
      const html = open(medium, href);
      const form = find(html, (e) => e.tagName === "form" && attr(e, "role") === "search")[0];
      expect(form && within(form, (e) => attr(e, "name") === "lens")).toEqual([]);
      expect(find(html, (e) => attr(e, "name") === "lens" && attr(e, "form") === "search")).toEqual([]);
    }
  });
});

describe("dashboard (24 §5.6)", () => {
  const P = "/p/aimem";
  const section = (html: string, heading: string) =>
    find(
      html,
      (e) =>
        e.tagName === "section" &&
        within(e, (h) => h.tagName === "h2" && nodeText(h).startsWith(heading)).length > 0,
    )[0];
  const cards = (html: string, heading: string) => {
    const s = section(html, heading);
    return s ? refsOf(s) : [];
  };

  it.each([undefined, "qa", "dev", "pm", "db"])(
    "lens %s: every count is the count of the page it links to",
    (lens) => {
      const html = open(medium, lens ? `${P}?lens=${lens}` : P);
      const counted = find(
        html,
        (e) =>
          e.tagName === "a" &&
          (/^View (all )?\d/.test(nodeText(e)) || attr(e.parentNode as never, "class") === "type"),
      );
      expect(counted.length).toBeGreaterThanOrEqual(3);
      for (const a of counted) {
        const href = attr(a, "href") ?? "";
        const n = Number(/(\d+)/.exec(nodeText(a))?.[1]);
        const page = open(medium, href);
        const title = texts(page, "title")[0] ?? "";
        // The board has no count in its title; its chip "All (N)" has it.
        const chip = find(page, (e) => e.tagName === "a" && /^All \(\d+\)$/.test(nodeText(e)))[0];
        const there =
          /: (\d+)/.exec(title)?.[1] ??
          /\((\d+)\)/.exec(chip ? nodeText(chip) : "")?.[1] ??
          String(everyPage(medium, href).length);
        expect(Number(there), `${nodeText(a)} → ${href}`).toBe(n);
      }
    },
  );

  it("shows the tasks in review in board order, the newest decisions and handoffs, at most a few", () => {
    const html = open(medium, P);
    const review = everyPage(medium, `${P}/tasks?status=review`);
    expect(cards(html, "Tasks in review")).toEqual(review.slice(0, REVIEW_CARDS));
    expect(cards(html, "Recent decisions")).toEqual(
      everyPage(medium, `${P}/decisions`).slice(0, RECENT_DECISIONS),
    );
    const feed = everyPage(medium, `${P}/handoffs`);
    expect(cards(html, "Latest handoffs")).toEqual(feed.slice(0, LATEST_HANDOFFS));
    const last = summarizeNotebook(medium.nb, medium.index, medium.now).lastHandoff;
    expect(feed[0]).toBe(last?.ref);
    expect([REVIEW_CARDS, RECENT_DECISIONS, LATEST_HANDOFFS]).toEqual([5, 5, 3]);
  });

  it("counts what is not reviewed yet on the records of the lens", () => {
    for (const lens of [undefined, "qa"]) {
      const c = lens ? lensed(medium, lens) : medium;
      const s = summarizeNotebook(c.nb, { ...c.index, records: shown(c) as IndexedRecord[] }, c.now);
      const main = all(dashboard(c));
      expect(main).toContain(`Agent-written: ${s.unreviewed.agent}`);
      expect(main).toContain(`Inferred: ${s.unreviewed.inferred}`);
      expect(main).toContain(`${s.total} record`);
    }
  });

  it("says when a part is empty, and a notebook without records says only that", () => {
    const c = withRecords(empty, record({ roles: ["qa"] }));
    const main = all(dashboard(c));
    for (const s of ["No tasks in review", "No decisions yet", "No handoffs yet"]) expect(main).toContain(s);
    expect(find(dashboard(c), (e) => e.tagName === "a" && /^View /.test(nodeText(e)))).toEqual([]);
    const none = dashboard(empty);
    expect(all(none)).toContain("No records yet");
    expect(find(none, (e) => e.tagName === "section")).toEqual([]);
  });

  it("has a lens form that works without the script, apart from the search form", () => {
    const html = dashboard(lensed(medium, "qa"));
    const forms = find(html, (e) => e.tagName === "form");
    expect(forms.map((f) => attr(f, "role") ?? attr(f, "class"))).toEqual(["search", "lens"]);
    const form = forms[1];
    expect(attr(form, "action")).toBe(P);
    expect(attr(form, "method") ?? "get").toBe("get");
    const select = form && within(form, (e) => e.tagName === "select")[0];
    expect(attr(select, "name")).toBe("lens");
    const label = find(html, (e) => e.tagName === "label" && attr(e, "for") === attr(select, "id"));
    expect(label.map(nodeText)).toEqual(["Role"]);
    const options = select ? within(select, (e) => e.tagName === "option") : [];
    expect(options.map((o) => attr(o, "value"))).toEqual([
      "",
      ...lensChoices(medium.nb, medium.index.records),
    ]);
    expect(options.filter((o) => attr(o, "selected") !== undefined).map((o) => attr(o, "value"))).toEqual([
      "qa",
    ]);
    expect(all(html)).toContain(
      "Filters the dashboard and lists. Records for all roles are always included. Search still covers the whole notebook.",
    );
    expect(all(html)).not.toContain("Show all roles");
  });

  it("gives the links under a part and the role line a 44 px target on a phone", () => {
    expect(STYLE).toMatch(
      /@media \(pointer: coarse\), \(max-width: 767px\) \{\s*\.more a, p\.lens a \{[^}]*min-height: 44px/,
    );
    expect(STYLE).toMatch(/\.results h3 \{[^}]*margin: 0 0 8px/);
  });

  it.each([undefined, "qa", "dev"])("lens %s: the count in each heading is the count of its list", (lens) => {
    const html = open(medium, lens ? `${P}?lens=${lens}` : P);
    for (const [heading, href] of [
      ["Tasks in review", `${P}/tasks?status=review`],
      ["Recent decisions", `${P}/decisions`],
      ["Latest handoffs", `${P}/handoffs`],
    ] as const) {
      const h = find(html, (e) => e.tagName === "h2" && nodeText(e).startsWith(heading))[0];
      const n = Number(/\((\d+)\)$/.exec(h ? nodeText(h) : "")?.[1]);
      expect(n, heading).toBe(
        everyPage(medium, lens ? `${href}${href.includes("?") ? "&" : "?"}lens=${lens}` : href).length,
      );
    }
  });

  it("says View 1 for one, and View all for more", () => {
    const one = withRecords(
      empty,
      record({ id: "tsk-aaaaaaaa", type: "task", status: "review" }),
      record({ id: "dec-aaaaaaaa", type: "decision", status: "accepted", file: "d.md" }),
      record({ id: "hnd-aaaaaaaa", type: "handoff", status: "final", file: "h.md" }),
    );
    const names = (html: string) =>
      find(html, (e) => e.tagName === "a" && /^View /.test(nodeText(e))).map(nodeText);
    expect(names(dashboard(one))).toEqual(["View 1 task in review", "View 1 decision", "View 1 handoff"]);
    const two = withRecords(
      one,
      record({ id: "tsk-bbbbbbbb", type: "task", status: "review", file: "t2.md" }),
      record({ id: "dec-bbbbbbbb", type: "decision", status: "accepted", file: "d2.md" }),
      record({ id: "hnd-bbbbbbbb", type: "handoff", status: "final", file: "h2.md" }),
    );
    expect(names(dashboard(two))).toEqual([
      "View all 2 tasks in review",
      "View all 2 decisions",
      "View all 2 handoffs",
    ]);
  });

  it("does not show the old table", () => {
    expect(find(dashboard(medium), (e) => e.tagName === "table")).toEqual([]);
  });

  it("escapes names, also of roles", () => {
    const evil = `"><script>alert(1)</script><img src=x onerror=alert(1)>`;
    const c = withRecords(
      { ...empty, nb: { ...empty.nb, config: { ...empty.nb.config, name: evil, roles: [evil, "qa"] } } },
      record({ id: "tsk-aaaaaaaa", type: "task", status: "review", title: evil, roles: [evil, "qa"] }),
    );
    for (const html of [dashboard(c), dashboard(lensed(c, "qa"))]) {
      expect(find(html, (e) => e.tagName === "img")).toEqual([]);
      expect(find(html, (e) => e.tagName === "script").map((e) => attr(e, "src"))).toEqual([
        "/assets/app.js",
      ]);
      expect(find(html, (e) => e.attrs.some((a) => /^on/.test(a.name)))).toEqual([]);
    }
  });
});

describe("addresses", () => {
  it("a project address is only ever a prefix; the dashboard with a lens has its own", async () => {
    const { projectHref, dashboardHref } = await import("../src/view.js");
    expect(projectHref("acme")).toBe("/p/acme");
    expect(projectHref.length).toBe(1);
    expect(dashboardHref("acme", "qa")).toBe("/p/acme?lens=qa");
    expect(dashboardHref("acme")).toBe("/p/acme");
  });
});
