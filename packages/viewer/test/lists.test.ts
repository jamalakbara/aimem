import { type IndexedRecord, summarizeNotebook } from "@aimem/core";
import { RECORD_TYPES, STATUSES, TRUST_LEVELS } from "@aimem/schema";
import type { DefaultTreeAdapterTypes as T } from "parse5";
import { beforeAll, describe, expect, it } from "vitest";
import { dashboard } from "../src/pages/dashboard.js";
import { decisionsPage } from "../src/pages/decisions.js";
import { handoffsPage } from "../src/pages/handoffs.js";
import { recordPage } from "../src/pages/record.js";
import { recordsPage } from "../src/pages/records.js";
import { searchPage } from "../src/pages/search.js";
import { PAGE_SIZE } from "../src/query.js";
import type { Page, ViewContext } from "../src/view.js";
import {
  all,
  attr,
  cardsOf,
  context,
  find,
  nodeText,
  record,
  refsOf,
  texts,
  within,
  withRecords,
} from "./pages.js";

let medium: ViewContext;
let empty: ViewContext;
beforeAll(async () => {
  medium = await context("medium");
  empty = { ...medium, problems: [], index: { ...medium.index, records: [], problems: [] } };
});

const P = "/p/aimem";
type View = (c: ViewContext, p: URLSearchParams) => Page;
const run =
  (view: View) =>
  (c: ViewContext, params: Record<string, string> | string = "") =>
    view(c, new URLSearchParams(params)).html;
const decisions = run(decisionsPage);
const handoffs = run(handoffsPage);
const records = run(recordsPage);
const N = (i: number) => String(i).padStart(8, "0");
const make =
  (type: "decision" | "handoff" | "incident", prefix: string) =>
  (i: number, over: Partial<IndexedRecord> = {}) =>
    record({
      id: `${prefix}-${N(i)}`,
      type,
      status: type === "decision" ? "accepted" : type === "handoff" ? "final" : "resolved",
      title: `${type} ${i}`,
      file: `.aimem/${type}s/${prefix}-${N(i)}.md`,
      fm: {},
      ...over,
    });
const dec = make("decision", "dec");
const hnd = make("handoff", "hnd");
const inc = make("incident", "inc");
const only = (...r: IndexedRecord[]) => withRecords(empty, ...r);
const link = (html: string, text: string) =>
  attr(find(html, (e) => e.tagName === "a" && nodeText(e).trim() === text)[0], "href");
const listed = (html: string) =>
  find(html, (e) => e.tagName === "ol" && /\bresults\b/.test(attr(e, "class") ?? "")).flatMap((o) =>
    refsOf(o),
  );
const cardText = (html: string) =>
  cardsOf(find(html, (e) => e.tagName === "main")[0] as T.Node).map((e) => nodeText(e).replace(/\s+/g, " "));
/** Follows Next from the first page to the last. */
function everyPage(view: (p: string) => string, first: string): string[] {
  const out: string[] = [];
  let next: string | undefined = first;
  for (let i = 0; next !== undefined && i < 500; i++) {
    const html = view(next);
    out.push(...listed(html));
    next = link(html, "Next")?.split("?")[1] ?? (link(html, "Next") ? "" : undefined);
  }
  return out;
}
const ids = (rs: IndexedRecord[]) => rs.map((r) => r.id);

describe("decision timeline (24 §5.5)", () => {
  it("lists every decision of the notebook once, whatever its status, and nothing else", () => {
    const want = ids(medium.index.records.filter((r) => r.type === "decision"));
    const got = everyPage((p) => decisions(medium, p), "");
    expect(got).toHaveLength(want.length);
    expect(new Set(got)).toEqual(new Set(want));
    expect(want.length).toBeGreaterThan(PAGE_SIZE);
  });

  it("puts the newest decision first, then by id, notebook and file", () => {
    const c = only(
      dec(1, { created: "2026-01-01T00:00:00Z" }),
      dec(2, { created: "2026-03-01T00:00:00Z" }),
      dec(4, { created: "2026-02-01T00:00:00Z" }),
      dec(3, { created: "2026-02-01T00:00:00Z" }),
    );
    expect(listed(decisions(c))).toEqual([2, 3, 4, 1].map((i) => `dec-${N(i)}`));
    const same = (nb: string | undefined, file: string) =>
      dec(1, { notebook: nb, file, created: "2026-01-01T00:00:00Z" });
    const t = cardText(
      decisions(only(same("hub", "b.md"), same(undefined, "z.md"), same(undefined, "a.md"))),
    );
    expect(t.map((x) => /[abz]\.md/.exec(x)?.[0])).toEqual(["a.md", "z.md", "b.md"]);
  });

  it("does not depend on the order of the index", () => {
    const rs = Array.from({ length: 40 }, (_, i) =>
      dec(i, { created: `2026-01-${String(1 + (i % 9)).padStart(2, "0")}T00:00:00Z` }),
    );
    expect(decisions(only(...rs))).toBe(decisions(only(...[...rs].reverse())));
  });

  it("shows the status as text on every card, and the date and author", () => {
    const text = cardText(
      decisions(only(dec(1, { status: "proposed", author: "human:rina", created: "2026-10-11T09:00:00Z" }))),
    );
    for (const s of ["Proposed", "11 Oct 2026", "human:rina", "dec-00000001"]) expect(text[0]).toContain(s);
    expect(text[0]).not.toMatch(/\bDecision\b/);
  });

  it("filters by status with chips, as `aimem list decision --status` does", () => {
    const html = decisions(medium);
    const chips = find(html, (e) => e.tagName === "nav" && attr(e, "aria-label") === "Status")[0] as T.Node;
    const labels = within(chips, (e) => e.tagName === "a").map((e) => nodeText(e));
    const by = (s: string) =>
      medium.index.records.filter((r) => r.type === "decision" && r.status === s).length;
    const total = medium.index.records.filter((r) => r.type === "decision").length;
    expect(labels).toEqual([
      `All (${total})`,
      ...STATUSES.decision.map((s) => `${s[0]?.toUpperCase()}${s.slice(1)} (${by(s)})`),
    ]);
    for (const s of STATUSES.decision) {
      const want = ids(medium.index.records.filter((r) => r.type === "decision" && r.status === s));
      const got = everyPage((p) => decisions(medium, p), `status=${s}`);
      expect(new Set(got), s).toEqual(new Set(want));
      expect(got.length, s).toBe(want.length);
    }
    expect(texts(decisions(medium, "status=accepted"), "h1")).toEqual(["Accepted decisions"]);
    expect(texts(decisions(medium, "status=accepted"), "title")[0]).toMatch(
      /^Accepted decisions: \d+ · aimem$/,
    );
    expect(texts(decisions(medium), "h1")).toEqual(["Decisions"]);
  });

  it("puts a status that is not in the schema under Other", () => {
    const c = only(dec(1, { status: "maybe" }), dec(2));
    expect(find(decisions(c), (e) => e.tagName === "a" && /^Other status/.test(nodeText(e)))).toHaveLength(1);
    expect(listed(decisions(c, "status=other"))).toEqual([`dec-${N(1)}`]);
    expect(texts(decisions(c, "status=other"), "h1")).toEqual(["Decisions with another status"]);
    expect(cardText(decisions(c, "status=other"))[0]).toContain("Maybe");
    expect(
      find(decisions(only(dec(2))), (e) => e.tagName === "a" && /^Other status/.test(nodeText(e))),
    ).toEqual([]);
  });
});

describe("the chain of decisions that replace each other (24 §5.5)", () => {
  const rep = (i: number, over: Partial<IndexedRecord["fm"]> = {}, rest: Partial<IndexedRecord> = {}) =>
    dec(i, { fm: over, created: `2026-0${i}-01T00:00:00Z`, ...rest });
  const card = (html: string, i: number) =>
    nodeText(
      cardsOf(find(html, (e) => e.tagName === "main")[0] as T.Node).find(
        (e) => attr(e, "data-ref") === `dec-${N(i)}`,
      ) as T.Node,
    ).replace(/\s+/g, " ");
  const a = (html: string, i: number) =>
    find(html, (e) => e.tagName === "a" && attr(e, "href") === `${P}/r/dec-${N(i)}`).length;

  it("points one step each way, with links, along A → B → C → D", () => {
    const html = decisions(
      only(
        rep(1, { superseded_by: `dec-${N(2)}` }, { status: "superseded" }),
        rep(2, { supersedes: `dec-${N(1)}`, superseded_by: `dec-${N(3)}` }, { status: "superseded" }),
        rep(3, { supersedes: `dec-${N(2)}`, superseded_by: `dec-${N(4)}` }, { status: "superseded" }),
        rep(4, { supersedes: `dec-${N(3)}` }),
      ),
    );
    expect(card(html, 1)).toContain("Replaced by decision 2");
    expect(card(html, 1)).not.toContain("Replaces");
    expect(card(html, 2)).toMatch(/Replaces decision 1.*Replaced by decision 3/);
    expect(card(html, 4)).toContain("Replaces decision 3");
    expect(card(html, 4)).not.toContain("Replaced by");
    expect(listed(html)).toEqual([4, 3, 2, 1].map((i) => `dec-${N(i)}`));
    // Every record is a link on its own card, and a link in the card of its neighbour.
    expect(a(html, 2)).toBe(3);
  });

  it("shows a loop, and a decision that replaces itself, without following them", () => {
    const html = decisions(
      only(
        rep(1, { supersedes: `dec-${N(2)}`, superseded_by: `dec-${N(2)}` }, { status: "superseded" }),
        rep(2, { supersedes: `dec-${N(1)}`, superseded_by: `dec-${N(1)}` }, { status: "superseded" }),
        rep(3, { supersedes: `dec-${N(3)}`, superseded_by: `dec-${N(3)}` }),
      ),
    );
    expect(listed(html)).toHaveLength(3);
    expect(card(html, 1)).toMatch(/Replaces decision 2.*Replaced by decision 2/);
    expect(card(html, 3)).toMatch(/Replaces decision 3.*Replaced by decision 3/);
  });

  it("says in words when the other decision is not here, and does not link it", () => {
    const html = decisions(
      only(
        rep(1, { superseded_by: "dec-00000000" }),
        rep(2, { supersedes: "other:dec-00000007" }),
        rep(3, { supersedes: "acme:dec-00000008" }),
      ),
    );
    expect(card(html, 1)).toContain("dec-00000000 (not in this notebook)");
    expect(card(html, 2)).toContain("other:dec-00000007 (not in this notebook)");
    expect(card(html, 3)).toContain("acme:dec-00000008 (not in this notebook)");
    expect(find(html, (e) => e.tagName === "a" && /dec-0000000[078]/.test(attr(e, "href") ?? ""))).toEqual(
      [],
    );
  });

  it("shows each side as written when the other side does not say the same", () => {
    const html = decisions(only(rep(1, { superseded_by: `dec-${N(2)}` }), rep(2)));
    expect(card(html, 1)).toContain("Replaced by decision 2");
    expect(card(html, 2)).not.toMatch(/Replaces|Replaced/);
  });

  it("keeps the order of the dates when the replacing decision is older", () => {
    const html = decisions(
      only(
        rep(5, { superseded_by: `dec-${N(2)}` }, { status: "superseded" }),
        rep(2, { supersedes: `dec-${N(5)}` }),
      ),
    );
    expect(listed(html)).toEqual([5, 2].map((i) => `dec-${N(i)}`));
  });

  it("keeps both cards of an id that two files carry, and says which file each is", () => {
    const html = decisions(
      only(
        rep(1),
        rep(1, {}, { file: ".aimem/decisions/other.md", title: "Second" }),
        rep(2, { supersedes: `dec-${N(1)}` }),
      ),
    );
    expect(listed(html).filter((x) => x === `dec-${N(1)}`)).toHaveLength(2);
    expect(html).toContain(".aimem/decisions/other.md");
    const anchors = find(html, (e) => e.tagName === "a" && /^r-/.test(attr(e, "id") ?? "")).map((e) =>
      attr(e, "id"),
    );
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it("shows a moved decision once, with where it went, and a hub decision with its label", () => {
    const html = decisions(only(rep(1, { moved_to: "hub" }), rep(2, {}, { notebook: "repo:api" })));
    expect(card(html, 1)).toContain("Moved to hub");
    expect(card(html, 2)).toContain("repo:api");
  });

  it("says in words how far each decision can be trusted", () => {
    const rs = [...TRUST_LEVELS, "wild"].map((trust, i) =>
      rep(i + 1, trust === "verified" ? { verified: "2026-02-02" } : {}, { trust }),
    );
    const text = cardText(decisions(only(...rs))).join("|");
    for (const s of [
      "Verified on 2 Feb 2026",
      "Not verified: written by an agent",
      "Not verified: inferred draft",
      "Not verified: wild",
    ])
      expect(text).toContain(s);
  });

  it("follows the chain of the fixture", () => {
    const html = decisions(medium, "status=accepted");
    const zod4 = cardText(html).find((t) => t.includes("dec-094vmt9t")) ?? "";
    expect(zod4).toContain("Replaces");
    expect(zod4).toContain("Use Zod 3");
    expect(a_href(html, "dec-0b20v421")).toBe(true);
  });
});
const a_href = (html: string, id: string) =>
  find(html, (e) => e.tagName === "a" && attr(e, "href") === `${P}/r/${id}`).length > 0;

describe("handoff feed (24 §5.5)", () => {
  it("lists every handoff once, newest first, and the first is the latest handoff of the dashboard", () => {
    const want = medium.index.records.filter((r) => r.type === "handoff");
    const got = everyPage((p) => handoffs(medium, p), "");
    expect(new Set(got)).toEqual(new Set(ids(want)));
    expect(got).toHaveLength(want.length);
    const last = summarizeNotebook(medium.nb, medium.index, medium.now).lastHandoff;
    expect(got[0]).toBe(last?.ref);
    expect(
      find(dashboard(medium), (e) => e.tagName === "p")
        .map(nodeText)
        .join(" "),
    ).toContain(last?.summary ?? "?");
  });

  it("puts the newest first and breaks a tie by id", () => {
    const c = only(
      hnd(1, { created: "2026-01-01T00:00:00Z" }),
      hnd(3, { created: "2026-02-01T00:00:00Z" }),
      hnd(2, { created: "2026-02-01T00:00:00Z" }),
    );
    expect(listed(handoffs(c))).toEqual([2, 3, 1].map((i) => `hnd-${N(i)}`));
  });

  it("shows the day, who wrote it, what it says, and where to go on", () => {
    const c = only(
      hnd(1, {
        author: "agent:claude-code",
        created: "2026-10-11T18:00:00Z",
        summary: "Done: the board · Next: lists",
        fm: { task: `dec-${N(9)}`, branch: "codex/m5-4" },
      }),
      dec(9, { title: "The task" }),
    );
    const [t] = cardText(handoffs(c));
    for (const s of [
      "11 Oct 2026",
      "agent:claude-code",
      "Done: the board · Next: lists",
      "codex/m5-4",
      "The task",
    ])
      expect(t).toContain(s);
    expect(a_href(handoffs(c), `dec-${N(9)}`)).toBe(true);
    expect(t).not.toContain("Final");
    expect(t).not.toMatch(/\bHandoff\b/);
  });

  it("names a task that is not in this notebook, without a link", () => {
    const [t] = cardText(handoffs(only(hnd(1, { fm: { task: "tsk-00000000" } }))));
    expect(t).toContain("tsk-00000000 (not in this notebook)");
  });

  it("says how far each handoff can be trusted", () => {
    const text = cardText(handoffs(only(hnd(1, { trust: "agent" }), hnd(2, { trust: "inferred" })))).join(
      "|",
    );
    expect(text).toContain("Not verified: written by an agent");
    expect(text).toContain("Not verified: inferred draft");
  });

  it("shows a severity only as sev1 to sev4", () => {
    const c = only(
      inc(1, { fm: { severity: "sev5" } }),
      inc(2, { fm: { severity: "sev0" } }),
      inc(3, { fm: { severity: "sev4" } }),
    );
    const text = cardText(records(c, "type=incident"));
    expect(text.find((t) => t.includes("inc-00000003"))).toContain("Sev 4");
    expect(text.filter((t) => /Sev \d/.test(t))).toHaveLength(1);
  });

  it("has no filter and no status chips", () => {
    const html = handoffs(medium);
    expect(find(html, (e) => e.tagName === "nav" && attr(e, "aria-label") === "Status")).toEqual([]);
    expect(texts(html, "h1")).toEqual(["Handoffs"]);
  });
});

describe("browse by type (24 §5.5)", () => {
  it("offers every type with its count, also one that has none, and links to the page of the type", () => {
    const html = records(only(dec(1), inc(1), inc(2)));
    const items = find(html, (e) => e.tagName === "li" && /\btype\b/.test(attr(e, "class") ?? "")).map((e) =>
      nodeText(e).replace(/\s+/g, " ").trim(),
    );
    expect(items).toEqual([
      "Decisions 1",
      "Tasks 0",
      "Memories 0",
      "Handoffs 0",
      "Incidents 2",
      "Runbooks 0",
      "Schemas 0",
      "Test cases 0",
    ]);
    const hrefs = find(html, (e) => e.tagName === "li" && /\btype\b/.test(attr(e, "class") ?? "")).map((e) =>
      attr(within(e, (a) => a.tagName === "a")[0] as T.Element, "href"),
    );
    expect(hrefs).toEqual([
      `${P}/decisions`,
      `${P}/tasks`,
      `${P}/records?type=memory`,
      `${P}/handoffs`,
      `${P}/records?type=incident`,
      `${P}/records?type=runbook`,
      `${P}/records?type=schema`,
      `${P}/records?type=testcase`,
    ]);
    expect(texts(html, "h1")).toEqual(["Browse by type"]);
  });

  it("lists the incidents, with severity, services and when it started", () => {
    const c = only(
      inc(1, { fm: { severity: "sev2", services: ["ci", "api"], started: "2026-10-12T08:00:00Z" } }),
      inc(2, { status: "investigating" }),
    );
    const html = records(c, "type=incident");
    expect(texts(html, "h1")).toEqual(["Incidents"]);
    const text = cardText(html);
    expect(text.find((t) => t.includes("inc-00000001"))).toMatch(/Sev 2.*ci, api.*Started 12 Oct 2026/);
    expect(text.find((t) => t.includes("inc-00000002"))).not.toMatch(/Sev|Started/);
    expect(text.join("|")).toContain("Investigating");
    expect(text.join("|")).toContain("Resolved");
  });

  it("lists exactly the records of the type, as `aimem list <type>` does, for every type", () => {
    for (const type of RECORD_TYPES) {
      const want = ids(medium.index.records.filter((r) => r.type === type));
      const got = everyPage((p) => records(medium, p), `type=${type}`);
      expect(new Set(got), type).toEqual(new Set(want));
      expect(got.length, type).toBe(want.length);
    }
  });

  it("filters the type by status, with the statuses of that type", () => {
    const html = records(medium, "type=incident");
    const labels = within(
      find(html, (e) => e.tagName === "nav" && attr(e, "aria-label") === "Status")[0] as T.Node,
      (e) => e.tagName === "a",
    ).map((e) => nodeText(e));
    expect(labels).toEqual([
      "All (5)",
      "Investigating (0)",
      "Mitigated (1)",
      "Resolved (3)",
      "Postmortem done (1)",
    ]);
    expect(listed(records(medium, "type=incident&status=resolved"))).toHaveLength(3);
    expect(texts(records(medium, "type=incident&status=resolved"), "h1")).toEqual(["Resolved incidents"]);
    expect(link(html, "Resolved (3)")).toBe(`${P}/records?type=incident&status=resolved`);
  });

  it("orders by the newest update", () => {
    const c = only(
      inc(1, { updated: "2026-01-01T00:00:00Z" }),
      inc(2, { updated: "2026-03-01T00:00:00Z" }),
      inc(3, { updated: "2026-02-01T00:00:00Z" }),
    );
    expect(listed(records(c, "type=incident"))).toEqual([2, 3, 1].map((i) => `inc-${N(i)}`));
  });

  it("ignores a type or status that is not one of the choices, says so, and does not repeat it", () => {
    const note = "A filter in the address is not one of the choices, so it was ignored.";
    for (const [params, needle] of [
      ["type=banana", "banana"],
      ["type=INCIDENT", "INCIDENT"],
      ["type=<script>", "<script>"],
      ["type=incident&status=banana", "banana"],
      ["type=incident&status=done", "?type=incident&status=done"],
      ["type=constructor", "constructor"],
    ] as const) {
      const html = records(medium, params);
      expect(all(html), params).toContain(note);
      expect(html, params).not.toContain(needle);
    }
    expect(texts(records(medium, "type=banana"), "h1")).toEqual(["Browse by type"]);
    expect(all(records(medium, "type=incident"))).not.toContain(note);
    expect(all(records(medium, "type=&status="))).not.toContain(note);
    expect(texts(records(medium, "type=incident&type=nope"), "h1")).toEqual(["Incidents"]);
  });

  it("says when there is nothing of a type, in a notebook with other records", () => {
    const html = records(only(dec(1)), "type=incident");
    expect(all(html)).toContain("No incidents yet");
    expect(listed(html)).toEqual([]);
  });
});

describe("what every list says (24 §5.5)", () => {
  const cases: [string, (c: ViewContext, p?: string) => string, string][] = [
    ["decisions", (c, p = "") => decisions(c, p), "No decisions yet"],
    ["handoffs", (c, p = "") => handoffs(c, p), "No handoffs yet"],
    ["incidents", (c, p = "") => records(c, p || "type=incident"), "No incidents yet"],
    ["records", (c, p = "") => records(c, p || "type=memory"), "No memories yet"],
  ];
  it.each(cases)("says so when the notebook has no %s, without an error", (_n, view, text) => {
    const html = view(empty);
    expect(all(html)).toContain(text);
    expect(listed(html)).toEqual([]);
  });

  it("says so, and offers to leave, when a status has no record", () => {
    const html = decisions(only(dec(1)), "status=rejected");
    expect(all(html)).toContain("No matching records");
    expect(link(html, "Clear filters")).toBe(`${P}/decisions`);
  });

  it("offers a menu of types, all with 0, in an empty notebook", () => {
    const html = records(empty);
    expect(all(html)).toContain("Decisions 0");
    expect(all(html)).toContain("Test cases 0");
  });

  const many = (n: number) => only(...Array.from({ length: n }, (_, i) => dec(i)));
  it("shows 25 a page, without losing or repeating a record, with the status in the links", () => {
    const c = many(PAGE_SIZE * 2 + 1);
    const got = everyPage((p) => decisions(c, p), "status=accepted");
    expect(got).toHaveLength(PAGE_SIZE * 2 + 1);
    expect(new Set(got).size).toBe(got.length);
    const html = decisions(c, "status=accepted&page=2");
    expect(link(html, "Next")).toBe(`${P}/decisions?status=accepted&page=3`);
    expect(link(html, "Previous")).toBe(`${P}/decisions?status=accepted`);
    expect(all(html)).toContain("Showing 26–50 of 51.");
    expect(texts(html, "title")[0]).toBe("Accepted decisions: 51, page 2 · aimem");
    expect(all(decisions(many(PAGE_SIZE), "status=accepted"))).not.toContain("Showing");
  });

  it.each(["0", "-1", "1.5", "x", "1e9", "", "99999999999999999999"])(
    "reads page %j leniently and stays in range",
    (page) => {
      const c = many(PAGE_SIZE + 3);
      for (const view of [
        decisions,
        (cc: ViewContext, p: Record<string, string>) => records(cc, { ...p, type: "decision" }),
      ]) {
        const n = listed(view(c, { page })).length;
        expect(n).toBeGreaterThan(0);
        expect(n).toBeLessThanOrEqual(PAGE_SIZE);
      }
    },
  );

  it("shows the last page for a page past the end", () => {
    const c = many(PAGE_SIZE + 3);
    expect(listed(decisions(c, "page=999"))).toEqual(listed(decisions(c, "page=2")));
  });

  it("is a page without scripts besides the shared one, with the whole width of a reading page", () => {
    for (const html of [
      decisions(medium),
      handoffs(medium),
      records(medium),
      records(medium, "type=incident"),
    ]) {
      expect(find(html, (e) => e.tagName === "script").map((e) => [attr(e, "src"), nodeText(e)])).toEqual([
        ["/assets/app.js", ""],
      ]);
      expect(find(html, (e) => e.attrs.some((a) => /^on|^style$/.test(a.name)))).toEqual([]);
      expect(html).not.toContain('class="wide"');
    }
  });

  it("escapes everything, wherever it comes from", () => {
    const x = `"><script>alert(1)</script><img src=x onerror='alert(1)'></title>`;
    const r = dec(1, {
      title: x,
      summary: x,
      status: x,
      trust: x,
      notebook: x,
      file: x,
      author: x,
      fm: {
        supersedes: x,
        superseded_by: `other:${x}`,
        moved_to: x,
        verified: x,
        task: x,
        branch: x,
        severity: x,
        services: [x],
        started: x,
      },
    });
    const h = hnd(2, { title: x, author: x, fm: { task: x, branch: x } });
    const i = inc(3, { title: x, fm: { severity: x, services: [x], started: x } });
    const c = withRecords(
      { ...empty, warnings: [x], stale: x, problems: [{ file: x, message: x }] },
      r,
      { ...r },
      h,
      i,
    );
    const pages = [
      decisions(c),
      decisions(c, { status: x, page: x }),
      decisions(c, "status=other"),
      handoffs(c),
      handoffs(c, { page: x }),
      records(c),
      records(c, { type: x }),
      records(c, "type=incident"),
      records(c, { type: "incident", status: x }),
    ];
    for (const html of pages) {
      expect(find(html, (e) => e.tagName === "img")).toEqual([]);
      expect(find(html, (e) => e.tagName === "script").map((e) => [attr(e, "src"), nodeText(e)])).toEqual([
        ["/assets/app.js", ""],
      ]);
      expect(find(html, (e) => e.attrs.some((a) => /^on|^style$/.test(a.name)))).toEqual([]);
      for (const e of find(html, (a) => attr(a, "href") !== undefined))
        expect(attr(e, "href")).toMatch(/^(#main$|\/(?!\/)[\x21-\x7e]*$)/);
    }
  });

  it("never serves the raw file text", () => {
    const c = only(dec(1, { text: "RAW FILE TEXT" }), hnd(2, { text: "RAW FILE TEXT" }));
    expect(decisions(c) + handoffs(c) + records(c, "type=decision")).not.toContain("RAW FILE TEXT");
  });
});

describe("the links in the header (24 §5.5)", () => {
  const nav = (html: string) => {
    const [n] = find(html, (e) => e.tagName === "nav" && attr(e, "aria-label") === "Sections");
    return within(n as T.Node, (e) => e.tagName === "a").map((e) => [
      nodeText(e),
      attr(e, "href"),
      attr(e, "aria-current"),
    ]);
  };
  const all4 = (current?: string) =>
    [
      ["Tasks", `${P}/tasks`],
      ["Decisions", `${P}/decisions`],
      ["Handoffs", `${P}/handoffs`],
      ["Browse", `${P}/records`],
    ].map(([t, h]) => [t, h, t === current ? "page" : undefined]);

  it("has four links, in this order, with the open page marked, on each of the pages", () => {
    expect(nav(decisions(medium))).toEqual(all4("Decisions"));
    expect(nav(handoffs(medium))).toEqual(all4("Handoffs"));
    expect(nav(records(medium))).toEqual(all4("Browse"));
    expect(nav(records(medium, "type=incident"))).toEqual(all4("Browse"));
    expect(nav(records(medium, "type=banana"))).toEqual(all4("Browse"));
  });

  it("is on every page of the notebook, and marks none of them on the others", () => {
    for (const html of [
      searchPage(medium, new URLSearchParams("q=schema")).html,
      recordPage(medium, "dec-094vmt9t").html,
      recordPage(medium, "dec-zzzzzzzz").html,
      dashboard(medium),
    ])
      expect(nav(html)).toEqual(all4());
  });
});
