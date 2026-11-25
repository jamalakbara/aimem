import type { IndexedRecord } from "@aimem/core";
import { DEFAULT_PRIORITY, STATUSES, TRUST_LEVELS } from "@aimem/schema";
import type { DefaultTreeAdapterTypes as T } from "parse5";
import { beforeAll, describe, expect, it } from "vitest";
import { BOARD_CAP, tasksPage } from "../src/pages/tasks.js";
import { PAGE_SIZE } from "../src/query.js";
import type { ViewContext } from "../src/view.js";
import { all, attr, context, find, nodeText, record, texts, within, withRecords } from "./pages.js";

let medium: ViewContext;
let empty: ViewContext;
beforeAll(async () => {
  medium = await context("medium");
  empty = { ...medium, problems: [], index: { ...medium.index, records: [], problems: [] } };
});

const open = (c: ViewContext, params: Record<string, string> | string = "") =>
  tasksPage(c, new URLSearchParams(params)).html;
const N = (i: number) => String(i).padStart(8, "0");
const task = (i: number, over: Partial<IndexedRecord> = {}) =>
  record({
    id: `tsk-${N(i)}`,
    type: "task",
    status: "open",
    title: `Task ${i}`,
    file: `.aimem/tasks/tsk-${N(i)}-task.md`,
    fm: {},
    ...over,
  });
const tasks = (n: number, over: (i: number) => Partial<IndexedRecord> = () => ({})) =>
  Array.from({ length: n }, (_, i) => task(i, over(i)));
/** A notebook with exactly these records. */
const only = (...r: IndexedRecord[]) => withRecords(empty, ...r);

const isCard = (e: T.Element) => e.tagName === "li" && attr(e, "data-ref") !== undefined;
const cardsOf = (root: T.Node): T.Element[] => within(root, isCard);
const refsOf = (root: T.Node): string[] => cardsOf(root).map((e) => attr(e, "data-ref") ?? "");
/** The board's columns: [heading text, cards]. */
const columns = (html: string): [string, T.Element[]][] =>
  find(html, (e) => e.tagName === "section").map((s) => [
    nodeText(within(s, (e) => e.tagName === "h2")[0] as T.Node).trim(),
    cardsOf(s),
  ]);
const col = (html: string, label: string) =>
  (columns(html).find(([h]) => h.startsWith(label)) ?? ["", []])[1].map((e) => attr(e, "data-ref") ?? "");
const listed = (html: string) =>
  find(html, (e) => e.tagName === "ol" && /\bresults\b/.test(attr(e, "class") ?? "")).flatMap((o) =>
    refsOf(o),
  );
const link = (html: string, text: string) =>
  attr(find(html, (e) => e.tagName === "a" && nodeText(e).trim() === text)[0], "href");
const P = "/p/aimem";

describe("board columns equal the task statuses (24 §5.4)", () => {
  it("has one column per status of the schema, in order, with the whole count", () => {
    const html = open(medium);
    const counts = new Map<string, number>();
    for (const r of medium.index.records)
      if (r.type === "task") counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    expect(columns(html).map(([h]) => h)).toEqual(
      ["Open", "In progress", "Blocked", "In review", "Done", "Cancelled"].map((label, i) => {
        const status = STATUSES.task[i] as string;
        return `${label} ${counts.get(status) ?? 0}`;
      }),
    );
  });

  it("shows tasks only, each once, and as many as fit in each column", () => {
    const html = open(medium);
    const tasksOf = medium.index.records.filter((r) => r.type === "task");
    const shown = columns(html).flatMap(([, c]) => c.map((e) => attr(e, "data-ref") ?? ""));
    expect(new Set(shown).size).toBe(shown.length);
    for (const id of shown) expect(tasksOf.map((r) => r.id)).toContain(id);
    const expected = STATUSES.task.reduce(
      (n, s) => n + Math.min(BOARD_CAP, tasksOf.filter((r) => r.status === s).length),
      0,
    );
    expect(shown).toHaveLength(expected);
  });

  it("puts a status that is not in the schema into an Other column, and nowhere else", () => {
    const c = only(task(1, { status: "wip" }), task(2, { status: "REVIEW" }), task(3, { status: "review" }));
    const html = open(c);
    expect(columns(html).map(([h]) => h)).toEqual([
      "Open 0",
      "In progress 0",
      "Blocked 0",
      "In review 1",
      "Done 0",
      "Cancelled 0",
      "Other status 2",
    ]);
    expect(col(html, "Other status")).toEqual([`tsk-${N(1)}`, `tsk-${N(2)}`]);
    // The status is not in the heading there, so each card says it.
    expect(nodeText(cardsOf(find(html, (e) => e.tagName === "section")[6] as T.Node)[0] as T.Node)).toContain(
      "Wip",
    );
  });

  it("has no Other column when every status is known", () => {
    expect(columns(open(medium)).map(([h]) => h)).not.toContain(expect.stringMatching(/^Other/));
  });

  it("shows ten cards of a column, and the list has the rest", () => {
    expect(BOARD_CAP).toBe(10);
    expect(col(open(only(...tasks(30))), "Open")).toHaveLength(10);
  });

  it("shows at most the first cards of a column and links to the rest", () => {
    const c = only(...tasks(BOARD_CAP + 5, () => ({ status: "review" })));
    const html = open(c);
    expect(col(html, "In review")).toHaveLength(BOARD_CAP);
    expect(columns(html).find(([h]) => h.startsWith("In review"))?.[0]).toBe(`In review ${BOARD_CAP + 5}`);
    expect(link(html, `View all ${BOARD_CAP + 5} tasks in review`)).toBe(`${P}/tasks?status=review`);
    // Not when everything is shown already.
    const few = open(only(...tasks(BOARD_CAP, () => ({ status: "review" }))));
    expect(few).not.toContain("View all");
    expect(few).not.toContain("Showing");
  });

  it.each([
    ["open", "open", "View all 16 open tasks"],
    ["in_progress", "in_progress", "View all 16 tasks in progress"],
    ["blocked", "blocked", "View all 16 blocked tasks"],
    ["review", "review", "View all 16 tasks in review"],
    ["done", "done", "View all 16 done tasks"],
    ["cancelled", "cancelled", "View all 16 cancelled tasks"],
    ["wip", "other", "View all 16 tasks with another status"],
  ])("says in a column of %s why it stops, and what the link opens", (status, column, label) => {
    const html = open(only(...tasks(16, () => ({ status }))));
    const full = find(html, (e) => e.tagName === "section").filter((s) => cardsOf(s).length > 0);
    expect(full).toHaveLength(1);
    const section = full[0] as T.Node;
    expect(within(section, (e) => e.tagName === "p").map((e) => nodeText(e).trim())).toContain(
      "Showing 10 of 16",
    );
    // The name of the link says the number and the status, so it can be read on its own.
    const links = within(section, (e) => e.tagName === "a" && /^View all/.test(nodeText(e)));
    expect(links.map((e) => [nodeText(e), attr(e, "href")])).toEqual([
      [label, `${P}/tasks?status=${column}`],
    ]);
    expect(texts(open(only(...tasks(16, () => ({ status }))), { status: column }), "h1")).toHaveLength(1);
  });

  it("gives every full column its own link name, and only full columns one", () => {
    const rs = [
      ...tasks(11, () => ({ status: "open" })),
      ...Array.from({ length: 12 }, (_, i) => task(100 + i, { status: "done" })),
      ...Array.from({ length: 10 }, (_, i) => task(200 + i, { status: "review" })),
    ];
    const html = open(only(...rs));
    const names = find(html, (e) => e.tagName === "a" && /^View all/.test(nodeText(e))).map((e) =>
      nodeText(e),
    );
    expect(names).toEqual(["View all 11 open tasks", "View all 12 done tasks"]);
    expect(texts(html, "p").filter((t) => t.startsWith("Showing"))).toEqual([
      "Showing 10 of 11",
      "Showing 10 of 12",
    ]);
  });

  it("says which columns are empty", () => {
    const html = open(only(task(1)));
    expect(texts(html, "p").filter((t) => t === "No tasks")).toHaveLength(5);
  });
});

describe("order (24 §5.4)", () => {
  const prio = (p: unknown) => ({ fm: p === undefined ? {} : { priority: p } });
  it("sorts a column by priority, then newest update, then id", () => {
    const c = only(
      task(1, { ...prio("p3"), updated: "2026-11-09T00:00:00Z" }),
      task(2, { ...prio("p0"), updated: "2026-11-01T00:00:00Z" }),
      task(3, { ...prio("p1"), updated: "2026-11-01T00:00:00Z" }),
      task(4, { ...prio("p1"), updated: "2026-11-05T00:00:00Z" }),
      task(5, { ...prio("p1"), updated: "2026-11-05T00:00:00Z" }),
    );
    expect(col(open(c), "Open")).toEqual([2, 4, 5, 3, 1].map((i) => `tsk-${N(i)}`));
  });

  it("counts a task without priority as the default priority, and one with an invalid priority last", () => {
    expect(DEFAULT_PRIORITY).toBe("p2");
    const same = "2026-11-01T00:00:00Z";
    const c = only(
      task(1, { ...prio("urgent"), updated: same }),
      task(2, { ...prio(undefined), updated: same }),
      task(3, { ...prio("p3"), updated: same }),
      task(4, { ...prio("p2"), updated: same }),
      task(5, { ...prio("p1"), updated: same }),
      task(6, { ...prio(2), updated: same }),
    );
    // p1, then the two p2 (written and default) by id, then p3, then what is not a priority.
    expect(col(open(c), "Open")).toEqual([5, 2, 4, 3, 1, 6].map((i) => `tsk-${N(i)}`));
  });

  it("sorts Done and Cancelled by newest update, whatever the priority", () => {
    const c = only(
      task(1, { status: "done", ...prio("p0"), updated: "2026-01-01T00:00:00Z" }),
      task(2, { status: "done", ...prio("p3"), updated: "2026-03-01T00:00:00Z" }),
      task(3, { status: "cancelled", ...prio("p0"), updated: "2026-01-01T00:00:00Z" }),
      task(4, { status: "cancelled", ...prio("p3"), updated: "2026-03-01T00:00:00Z" }),
    );
    const html = open(c);
    expect(col(html, "Done")).toEqual([2, 1].map((i) => `tsk-${N(i)}`));
    expect(col(html, "Cancelled")).toEqual([4, 3].map((i) => `tsk-${N(i)}`));
  });

  it("does not depend on the order of the index", () => {
    const rs = tasks(30, (i) => ({
      ...prio(`p${i % 4}`),
      updated: `2026-11-${String(1 + (i % 9)).padStart(2, "0")}T00:00:00Z`,
    }));
    const a = open(only(...rs), "status=open&page=1");
    const b = open(only(...[...rs].reverse()), "status=open&page=1");
    expect(a).toBe(b);
  });

  it("breaks the last tie by notebook, then file", () => {
    const x = (nb: string | undefined, file: string) =>
      task(1, { notebook: nb, file, updated: "2026-11-01T00:00:00Z" });
    const c = only(
      x("hub", ".aimem/tasks/b.md"),
      x(undefined, ".aimem/tasks/z.md"),
      x(undefined, ".aimem/tasks/a.md"),
    );
    const text = within(
      find(open(c), (e) => e.tagName === "section")[0] as T.Node,
      (e) => e.tagName === "li",
    ).map((e) => nodeText(e));
    expect(text.map((t) => /tasks\/(\w)\.md/.exec(t)?.[1])).toEqual(["a", "z", "b"]);
  });
});

describe("cards (24 §5.4)", () => {
  const card = (r: IndexedRecord, params = "") => {
    const html = open(only(r), params);
    return nodeText(cardsOf(find(html, (e) => e.tagName === "main")[0] as T.Node)[0] as T.Node).replace(
      /\s+/g,
      " ",
    );
  };

  it("does not repeat the type or the status that the column says", () => {
    const text = card(task(1, { status: "review", title: "Zebra" }));
    expect(text).not.toMatch(/Task/);
    expect(text).not.toMatch(/\bIn review\b/);
    expect(text).toContain("Zebra");
  });

  it("shows a priority only when the record has one, in words for assistive technology", () => {
    const html = open(only(task(1, { fm: { priority: "p1" } }), task(2)));
    const [one, two] = cardsOf(find(html, (e) => e.tagName === "main")[0] as T.Node);
    expect(nodeText(one as T.Node)).toContain("Priority P1");
    expect(nodeText(two as T.Node)).not.toContain("Priority");
    expect(nodeText(one as T.Node)).not.toContain("Priority p1");
    // Not a priority: nothing shown.
    expect(card(task(3, { fm: { priority: "urgent" } }))).not.toMatch(/Priority|urgent/i);
  });

  it("shows the assignee, the due date, how many tasks block it, and the notebook", () => {
    const text = card(
      task(1, {
        notebook: "repo:api",
        fm: { assignee: "human:rina", due: "2026-12-15", blocked_by: ["tsk-00000007", "tsk-00000008"] },
      }),
    );
    for (const s of ["human:rina", "Due 15 Dec 2026", "Blocked by 2 tasks", "repo:api", "tsk-00000001"])
      expect(text).toContain(s);
    expect(card(task(2, { fm: { blocked_by: ["tsk-00000007"] } }))).toContain("Blocked by 1 task");
    expect(card(task(3, { fm: { blocked_by: [] } }))).not.toContain("Blocked by");
  });

  it("says in words how far every card can be trusted", () => {
    const rs = [...TRUST_LEVELS, "wild"].map((trust, i) =>
      task(i, { trust, fm: trust === "verified" ? { verified: "2026-11-02" } : {} }),
    );
    const html = open(only(...rs));
    const text = cardsOf(find(html, (e) => e.tagName === "main")[0] as T.Node).map((e) =>
      nodeText(e).replace(/\s+/g, " "),
    );
    expect(text).toHaveLength(4);
    expect(text.join("|")).toContain("Verified on 2 Nov 2026");
    expect(text.join("|")).toContain("Not verified: written by an agent");
    expect(text.join("|")).toContain("Not verified: inferred draft");
    expect(text.join("|")).toContain("Not verified: wild");
    expect(card(task(9, { trust: "verified" }))).not.toMatch(/Verified on/);
  });

  it("links the title to the record page", () => {
    const html = open(only(task(1)));
    const a = find(html, (e) => e.tagName === "a" && nodeText(e) === "Task 1")[0];
    expect(attr(a, "href")).toBe(`${P}/r/tsk-${N(1)}`);
  });

  it("tells a moved task from the real one, and a duplicate id by its file", () => {
    const c = only(
      task(1, { fm: { moved_to: "hub" } }),
      task(2),
      task(2, { file: ".aimem/tasks/other.md", title: "Second" }),
    );
    const html = open(c);
    expect(html).toContain("Moved to hub");
    expect(html).toContain(".aimem/tasks/other.md");
    const ids = find(html, (e) => e.tagName === "a" && /^r-/.test(attr(e, "id") ?? "")).map((e) =>
      attr(e, "id"),
    );
    expect(ids).toEqual([`r-tsk-${N(1)}`, `r-tsk-${N(2)}`, `r-tsk-${N(2)}-2`]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives a hub task its label, from a real project", async () => {
    const c = await context("multirepo/backend");
    const html = open(c);
    expect(c.index.records.some((r) => r.type === "task" && r.notebook === "hub")).toBe(true);
    expect(all(html)).toContain("hub");
    expect(col(html, "Open")).toHaveLength(1);
  });
});

describe("chips and the list of one status (24 §5.4)", () => {
  it("links every status with its count, and says which tasks are all of them", () => {
    const html = open(medium);
    const chips = find(html, (e) => e.tagName === "nav" && attr(e, "aria-label") === "Status");
    expect(chips).toHaveLength(1);
    const links = within(chips[0] as T.Node, (e) => e.tagName === "a").map((e) => [
      nodeText(e),
      attr(e, "href"),
    ]);
    const total = medium.index.records.filter((r) => r.type === "task").length;
    expect(links[0]).toEqual([`All (${total})`, `${P}/tasks`]);
    expect(links.slice(1).map(([t]) => t)).toEqual([
      "Open (16)",
      "In progress (1)",
      "Blocked (1)",
      "In review (1)",
      "Done (4)",
      "Cancelled (2)",
    ]);
    expect(links[4]?.[1]).toBe(`${P}/tasks?status=review`);
  });

  it("marks the chosen status as current", () => {
    const html = open(medium, "status=review");
    const current = find(html, (e) => attr(e, "aria-current") === "true" && e.tagName === "a");
    expect(current.map((e) => nodeText(e))).toEqual(["In review (1)"]);
    // On the board, All is the one that is open.
    expect(
      find(open(medium), (e) => e.tagName === "a" && attr(e, "aria-current") === "true").map((e) =>
        nodeText(e),
      ),
    ).toEqual([`All (${medium.index.records.filter((r) => r.type === "task").length})`]);
  });

  it("lists exactly the tasks of that status, as the CLI does (list task --status review)", () => {
    for (const status of STATUSES.task) {
      const want = medium.index.records
        .filter((r) => r.type === "task" && r.status === status)
        .map((r) => r.id);
      const got: string[] = [];
      let next: string | undefined = `status=${status}`;
      for (let i = 0; next !== undefined && i < 10; i++) {
        const html = open(medium, next);
        got.push(...listed(html));
        next = link(html, "Next")?.split("?")[1];
      }
      expect(new Set(got), status).toEqual(new Set(want));
      expect(got.length, status).toBe(want.length);
    }
  });

  it("names the list and puts the count in the title, so a screen reader says it", () => {
    const html = open(medium, "status=review");
    expect(texts(html, "h1")).toEqual(["Tasks in review"]);
    expect(texts(html, "title")[0]).toBe("Tasks in review: 1 · aimem");
    for (const [status, h] of [
      ["open", "Open tasks"],
      ["in_progress", "Tasks in progress"],
      ["blocked", "Blocked tasks"],
      ["done", "Done tasks"],
      ["cancelled", "Cancelled tasks"],
    ] as const)
      expect(texts(open(medium, { status }), "h1")).toEqual([h]);
    expect(texts(open(only(task(1, { status: "wip" })), "status=other"), "h1")).toEqual([
      "Tasks with another status",
    ]);
    expect(texts(html.replace(/status=review/, ""), "h1")).toEqual(["Tasks in review"]);
    expect(texts(open(medium), "h1")).toEqual(["Tasks"]);
    expect(texts(open(medium), "title")[0]).toBe("Tasks · aimem");
  });

  it("shows the summary in the list, but not on the board", () => {
    const c = only(task(1, { summary: "Why this one matters." }));
    expect(open(c)).not.toContain("Why this one matters.");
    expect(open(c, "status=open")).toContain("Why this one matters.");
  });

  it("lists a status that is not in the schema under Other", () => {
    const c = only(task(1, { status: "wip" }), task(2));
    expect(listed(open(c, "status=other"))).toEqual([`tsk-${N(1)}`]);
  });

  it("keeps the order of the column", () => {
    const c = only(
      task(1, { status: "done", updated: "2026-01-01T00:00:00Z" }),
      task(2, { status: "done", updated: "2026-02-01T00:00:00Z" }),
    );
    expect(listed(open(c, "status=done"))).toEqual([`tsk-${N(2)}`, `tsk-${N(1)}`]);
  });
});

describe("pages (24 §5.4)", () => {
  let many: ViewContext;
  beforeAll(() => {
    many = only(...tasks(PAGE_SIZE * 2 + 1));
  });
  it("shows 25 a page, in order, without losing or repeating a task", () => {
    const seen: string[] = [];
    let href: string | undefined = "status=open";
    for (let i = 0; href !== undefined && i < 10; i++) {
      const html = open(many, href.slice(href.indexOf("?") + 1));
      const page = listed(html);
      expect(page.length).toBeLessThanOrEqual(PAGE_SIZE);
      seen.push(...page);
      href = link(html, "Next");
    }
    expect(seen).toHaveLength(PAGE_SIZE * 2 + 1);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual(
      listed(open(many, "status=open&page=1")).concat(
        listed(open(many, "status=open&page=2")),
        listed(open(many, "status=open&page=3")),
      ),
    );
  });

  it("keeps the status in the links, and says where it is", () => {
    const html = open(many, "status=open&page=2");
    expect(link(html, "Next")).toBe(`${P}/tasks?status=open&page=3`);
    expect(link(html, "Previous")).toBe(`${P}/tasks?status=open`);
    expect(all(html)).toContain("Showing 26–50 of 51.");
    expect(find(open(many, "status=open"), (e) => e.tagName === "a" && nodeText(e) === "Previous")).toEqual(
      [],
    );
    expect(
      find(open(many, "status=open&page=3"), (e) => e.tagName === "a" && nodeText(e) === "Next"),
    ).toEqual([]);
    expect(texts(html, "title")[0]).toBe("Open tasks: 51, page 2 · aimem");
    expect(find(html, (e) => e.tagName === "nav" && attr(e, "aria-label") === "Pages")).toHaveLength(1);
  });

  it("says nothing about pages when there is one", () => {
    const html = open(only(...tasks(PAGE_SIZE)), "status=open");
    expect(all(html)).not.toContain("Showing");
    expect(find(html, (e) => e.tagName === "nav" && attr(e, "aria-label") === "Pages")).toEqual([]);
  });

  it.each(["0", "-1", "1.5", "x", "1e9", "", "99999999999999999999", "%00"])(
    "reads page %j leniently and stays in range",
    (page) => {
      const html = open(many, { status: "open", page });
      expect(listed(html).length).toBeGreaterThan(0);
      expect(listed(html).length).toBeLessThanOrEqual(PAGE_SIZE);
    },
  );

  it("shows the last page for a page past the end", () => {
    expect(listed(open(many, "status=open&page=999"))).toEqual(listed(open(many, "status=open&page=3")));
    expect(listed(open(many, "status=open&page=3"))).toHaveLength(1);
  });
});

describe("what the page says (24 §5.4)", () => {
  it("says when there are no tasks, on the board and for a status", () => {
    for (const [params, h1] of [
      ["", "Tasks"],
      ["status=review", "Tasks in review"],
      ["status=other", "Tasks with another status"],
    ] as const) {
      const html = open(empty, params);
      expect(texts(html, "h1")).toEqual([h1]);
      expect(all(html)).toContain("No tasks yet");
      expect(columns(html)).toEqual([]);
    }
  });

  it("says so when a status has no task, and offers to leave it", () => {
    const html = open(only(task(1)), "status=review");
    expect(all(html)).toContain("No matching records");
    expect(link(html, "Clear filters")).toBe(`${P}/tasks`);
    expect(listed(html)).toEqual([]);
  });

  it("ignores a status that is not one of the choices, says so, and does not repeat it", () => {
    for (const [status, needle] of [
      ["banana", "banana"],
      ["<script>x</script>", "<script>x"],
      ["REVIEW", "REVIEW"],
      ["constructor", "constructor"],
      ["__proto__", "__proto__"],
      ["superseded", "?status=superseded"],
    ] as const) {
      const html = open(medium, { status });
      expect(all(html), status).toContain(
        "A filter in the address is not one of the choices, so it was ignored.",
      );
      expect(html, status).not.toContain(needle);
      expect(columns(html), status).toHaveLength(6);
    }
    expect(all(open(medium, "status="))).not.toContain("not one of the choices");
    expect(all(open(medium, "status=review"))).not.toContain("not one of the choices");
    expect(all(open(medium, "page=2"))).not.toContain("not one of the choices");
  });

  it("uses the first of a repeated status", () => {
    expect(texts(open(medium, "status=review&status=open"), "h1")).toEqual(["Tasks in review"]);
    expect(texts(open(medium, "status=nope&status=review"), "h1")).toEqual(["Tasks"]);
  });

  it("is a page without scripts besides the shared one", () => {
    for (const params of ["", "status=open"]) {
      const html = open(medium, params);
      expect(find(html, (e) => e.tagName === "script").map((e) => [attr(e, "src"), nodeText(e)])).toEqual([
        ["/assets/app.js", ""],
      ]);
      expect(find(html, (e) => e.attrs.some((a) => /^on|^style$/.test(a.name)))).toEqual([]);
    }
  });

  it("gives the board room, and only the board", () => {
    expect(open(medium)).toMatch(/<main id="main" tabindex="-1" class="wide">/);
    expect(open(medium, "status=open")).not.toContain('class="wide"');
  });

  it("escapes everything, wherever it comes from", () => {
    const x = `"><script>alert(1)</script><img src=x onerror='alert(1)'></title>`;
    const r = task(1, {
      title: x,
      summary: x,
      status: x,
      trust: x,
      notebook: x,
      file: x,
      author: x,
      fm: { priority: x, assignee: x, due: x, blocked_by: [x], moved_to: x, verified: x },
    });
    const c = withRecords({ ...empty, warnings: [x], stale: x, problems: [{ file: x, message: x }] }, r, {
      ...r,
    });
    for (const p of ["", "status=other", { status: x, page: x }] as (string | Record<string, string>)[]) {
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

  it("never serves the raw file text", () => {
    expect(
      open(only(task(1, { text: "RAW FILE TEXT" }))) +
        open(only(task(1, { text: "RAW FILE TEXT" })), "status=open"),
    ).not.toContain("RAW FILE TEXT");
  });
});

describe("the way to the page (24 §5.4)", () => {
  const nav = (html: string) =>
    find(html, (e) => e.tagName === "nav" && attr(e, "aria-label") === "Sections");

  it("is in the header of the board, with the page marked as current", () => {
    const html = open(medium);
    const [n] = nav(html);
    expect(n).toBeDefined();
    const links = within(n as T.Node, (e) => e.tagName === "a");
    expect(links.map((e) => [nodeText(e), attr(e, "href"), attr(e, "aria-current")])).toEqual([
      ["Tasks", `${P}/tasks`, "page"],
    ]);
    const header = find(html, (e) => e.tagName === "header")[0];
    expect(
      within(header as T.Node, (e) => e.tagName === "nav" && attr(e, "aria-label") === "Sections"),
    ).toHaveLength(1);
  });

  it("is on every page of the notebook, not as current elsewhere", async () => {
    const { searchPage } = await import("../src/pages/search.js");
    const { recordPage } = await import("../src/pages/record.js");
    const { dashboard } = await import("../src/pages/dashboard.js");
    const pages = [
      searchPage(medium, new URLSearchParams("q=schema")).html,
      recordPage(medium, "dec-094vmt9t").html,
      recordPage(medium, "dec-zzzzzzzz").html,
      dashboard(medium),
    ];
    for (const html of pages) {
      expect(nav(html)).toHaveLength(1);
      expect(find(html, (e) => e.tagName === "a" && attr(e, "aria-current") === "page")).toEqual([]);
    }
  });

  it("is not on a page that has no notebook", async () => {
    const { layout } = await import("../src/pages/layout.js");
    const { errorPage } = await import("../src/pages/error.js");
    expect(nav(layout("Page not found", errorPage(404, "x")))).toEqual([]);
  });

  it("only links to pages that exist", () => {
    const [n] = nav(open(medium));
    for (const a of within(n as T.Node, (e) => e.tagName === "a"))
      expect(attr(a, "href")).toMatch(/^\/p\/aimem\/(tasks)$/);
  });

  it("offers the board in a desktop layout, a stacked one on a phone, and no horizontal scroll", async () => {
    const { STYLE } = await import("../src/assets/style.js");
    expect(STYLE).toMatch(
      /@media \(min-width: 1100px\)\s*\{\s*\.board\s*\{\s*grid-template-columns: repeat\(6, 1fr\)/,
    );
    expect(STYLE).toMatch(
      /@media \(min-width: 768px\)\s*\{\s*\.board\s*\{\s*grid-template-columns: repeat\(3, 1fr\)/,
    );
    expect(STYLE).toMatch(/\.board\s*\{[^}]*grid-template-columns: 1fr/);
    expect(STYLE).not.toMatch(/\.board[^{]*\{[^}]*overflow-x/);
  });
});
