import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCsv, sheetToRecords } from "../src/index.js";

const IMPORTS = fileURLToPath(new URL("../../../fixtures/imports/", import.meta.url));
const read = (n: string) => readFileSync(join(IMPORTS, n), "utf8");

describe("CSV (RFC 4180)", () => {
  it("handles quotes, doubled quotes, commas and newlines in cells, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"\nthere'],
    ]);
  });
});

describe("sheet templates (16 §4.1)", () => {
  it("maps 21 task rows: 20 records, one row error with its sheet row number", () => {
    const r = sheetToRecords(parseCsv(read("tasks.csv")), "tasks.csv");
    expect(r.type).toBe("task");
    expect(r.items).toHaveLength(20);
    expect(r.errors).toEqual([{ row: 7, reason: "priority 'p9' is not one of p0, p1, p2, p3" }]);
    const first = r.items[0];
    expect(first).toMatchObject({
      row: 2,
      record: {
        type: "task",
        title: "Add health route",
        summary: "Add health route for the parcel hub.",
        status: "in_progress",
        roles: ["dev"],
        tags: ["backlog"],
        fields: { priority: "p0", due: "2026-12-15" },
        paths: ["src/api/**"],
      },
    });
    expect(first?.record.body).toMatch(
      /^## Goal\n\nAdd health route for the parcel hub\.\n\n## Acceptance criteria\n\n_Not stated in the sheet\._\n\n## Notes\n\n\| Column \| Value \|\n\|---\|---\|\n\| sprint \| S1 \|$/,
    );
    expect(r.items[1]?.record.body).toMatch(/## Notes\n\nFirst line\nsecond line, with a comma/);
    expect(r.items[1]?.record).toMatchObject({ fields: { assignee: "dana" }, tags: ["backlog", "q1"] });
  });

  it("keeps a formula-looking cell as plain text", () => {
    const r = sheetToRecords(parseCsv(read("tasks.csv")), "tasks.csv");
    expect(r.items[2]?.record.body).toContain("=cmd|' /C calc'!A0");
  });

  it("maps testcases and incidents, and picks the template from the headers", () => {
    const t = sheetToRecords(parseCsv(read("testcases.csv")), "testcases.csv");
    expect(t.type).toBe("testcase");
    expect(t.items[0]?.record).toMatchObject({ status: "ready", fields: { automation: "vitest" } });
    expect(t.items[0]?.record.body).toMatch(
      /^## Preconditions\n\nParcel exists\n\n## Steps\n\nPost a scan\n\n## Expected\n\nState is in_transit\n\n## Last result\n\n_Not stated in the sheet\._$/,
    );
    const i = sheetToRecords(parseCsv(read("incidents.csv")), "incidents.csv");
    expect(i.type).toBe("incident");
    expect(i.items[0]?.record).toMatchObject({
      fields: {
        severity: "sev2",
        started: "2026-03-10T09:10:00Z",
        resolved_at: "2026-03-10T09:50:00Z",
        services: ["worker", "api"],
      },
    });
    expect(i.items[0]?.record.body).toMatch(
      /## Timeline\n\nStarted 2026-03-10T09:10:00Z; resolved 2026-03-10T09:50:00Z\./,
    );
  });

  it("reports a sheet without a known template, and rows without a title", () => {
    expect(() =>
      sheetToRecords(
        [
          ["foo", "bar"],
          ["1", "2"],
        ],
        "x.csv",
      ),
    ).toThrow(/no sheet template matches the headers/);
    const r = sheetToRecords(
      [
        ["title", "summary", "status"],
        ["", "no title", "open"],
        ["Ok", "Fine.", "nope"],
      ],
      "t.csv",
      "tasks",
    );
    expect(r.errors).toEqual([
      { row: 2, reason: "title is empty" },
      { row: 3, reason: "status 'nope' is not one of open, in_progress, blocked, review, done, cancelled" },
    ]);
  });

  it("an unterminated quote is an error for its row only; later rows still parse (QA #100 finding 3)", () => {
    const csv =
      'title,summary,status\nGood,Fine.,open\n"Broken,row never closes,open\nAfter,After row.,open\n';
    const r = sheetToRecords(parseCsv(csv), "q.csv", "tasks");
    expect(r.items.map((i) => [i.row, i.record.title])).toEqual([
      [2, "Good"],
      [4, "After"],
    ]);
    expect(r.errors).toEqual([{ row: 3, reason: "unterminated quoted cell" }]);
  });

  it("reports rows with too few or too many cells, and refuses '..' paths (findings 7, 8)", () => {
    const r = sheetToRecords(
      [
        ["title", "summary", "status", "paths"],
        ["Short", "Fine."],
        ["Long", "Fine.", "open", "src/**", "extra", "more"],
        ["Escape", "Bad path.", "open", "../../etc/passwd"],
      ],
      "r.csv",
      "tasks",
    );
    expect(r.items.map((i) => i.row)).toEqual([2, 3]);
    expect(r.notes).toEqual([
      { row: 2, reason: "has 2 cells, the header has 4" },
      { row: 3, reason: "has 6 cells, the header has 4; the extra cells were left out" },
    ]);
    expect(r.errors).toEqual([
      { row: 4, reason: "paths must be relative to the repository, without '.' or '..' parts" },
    ]);
  });

  it("a key column keys rows by value instead of position (finding 4)", () => {
    const r = sheetToRecords(
      [
        ["key", "title", "summary"],
        ["T-1", "Alpha", "A."],
        ["T-1", "Bravo", "B."],
        ["", "Charlie", "C."],
      ],
      "k.csv",
      "tasks",
    );
    expect(r.items.map((i) => [i.row, i.key])).toEqual([[2, "T-1"]]);
    expect(r.errors).toEqual([
      { row: 3, reason: "key 'T-1' is used by row 2 too" },
      { row: 4, reason: "key is empty" },
    ]);
    expect(r.extraColumns).toEqual([]);
  });
});
