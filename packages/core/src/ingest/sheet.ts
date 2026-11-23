import { STATUSES } from "@aimem/schema";
import { firstSentence } from "../adopt/markdown.js";
import type { DocumentRecord } from "./document.js";

/** RFC 4180 CSV: quoted cells, doubled quotes, commas and newlines inside quotes, CRLF, a leading BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

type SheetType = "task" | "testcase" | "incident";

/** 16 §4.1 columns per sheet template. */
export const SHEET_COLUMNS: Record<"tasks" | "testcases" | "incidents", string[]> = {
  tasks: ["title", "summary", "status", "priority", "assignee", "roles", "tags", "due", "paths", "notes"],
  testcases: ["title", "summary", "preconditions", "steps", "expected", "status", "covers", "automation"],
  incidents: [
    "title",
    "summary",
    "severity",
    "started",
    "resolved_at",
    "services",
    "impact",
    "root_cause",
    "fix",
  ],
};
const TYPE_OF = { tasks: "task", testcases: "testcase", incidents: "incident" } as const;
/** Columns that tell the templates apart when `--as` is not given. */
const SIGNATURE: [keyof typeof SHEET_COLUMNS, string[]][] = [
  ["testcases", ["steps", "expected"]],
  ["incidents", ["severity", "impact"]],
  ["tasks", ["priority", "assignee", "due", "notes", "status"]],
];

export interface SheetResult {
  type: SheetType;
  items: { row: number; record: DocumentRecord & { paths?: string[] } }[];
  errors: { row: number; reason: string }[];
  /** Columns that are not part of the template; kept in the body as a small table. */
  extraColumns: string[];
}

const NOT_STATED = "_Not stated in the sheet._";
const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const normal = (h: string) => h.trim().toLowerCase().replace(/\s+/g, "_");
const control = (s: string) =>
  [...s]
    .filter((c) => {
      const code = c.charCodeAt(0);
      return c === "\t" || c === "\n" || (code >= 32 && code !== 127);
    })
    .join("");
const cellText = (v: string | undefined) => control(v ?? "").trim();
const mdCell = (v: string) => v.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const NAME = /^[a-z0-9][a-z0-9_-]*$/i;

/**
 * 16 §4.1: one row = one record. Headers equal frontmatter field names (case-insensitive, spaces → _);
 * unknown columns go into the body as a small table. A bad row is reported with its sheet row number
 * (the header is row 1) and the other rows still import. Cells are text: nothing is evaluated.
 */
export function sheetToRecords(rows: string[][], fileName: string, typeHint?: string): SheetResult {
  const [header = [], ...data] = rows;
  const cols = header.map(normal);
  const hint = typeHint?.toLowerCase();
  const kind: keyof typeof SHEET_COLUMNS | undefined =
    hint === "tasks" || hint === "testcases" || hint === "incidents"
      ? hint
      : cols.includes("title")
        ? SIGNATURE.find(([, sig]) => sig.some((c) => cols.includes(c)))?.[0]
        : undefined;
  if (!kind)
    throw new Error(
      `no sheet template matches the headers of ${fileName}; use the columns of aimem templates export tasks|testcases|incidents`,
    );
  const type = TYPE_OF[kind];
  const known = new Set(SHEET_COLUMNS[kind]);
  const extraColumns = cols.filter((c) => c && !known.has(c));
  const items: SheetResult["items"] = [];
  const errors: SheetResult["errors"] = [];

  /** Maps one row; false when the row was reported as an error. */
  const mapRow = (cells: string[], i: number): boolean => {
    const row = i + 2;
    const get = (c: string) => {
      const at = cols.indexOf(c);
      return at < 0 ? "" : cellText(cells[at]);
    };
    const fail = (reason: string): false => {
      errors.push({ row, reason });
      return false;
    };
    const title = get("title").replace(/\s+/g, " ").slice(0, 120);
    if (!title) return fail("title is empty");
    const status = get("status");
    const allowed = STATUSES[type] as readonly string[];
    if (status && !allowed.includes(status))
      return fail(`status '${status}' is not one of ${allowed.join(", ")}`);
    const fields: Record<string, unknown> = {};
    if (type === "task") {
      const priority = get("priority").toLowerCase();
      if (priority && !["p0", "p1", "p2", "p3"].includes(priority))
        return fail(`priority '${get("priority")}' is not one of p0, p1, p2, p3`);
      if (priority) fields.priority = priority;
      if (get("assignee")) fields.assignee = get("assignee");
      if (get("due") && !DATE.test(get("due"))) return fail(`due '${get("due")}' is not a date (YYYY-MM-DD)`);
      if (get("due")) fields.due = get("due");
    }
    if (type === "testcase") {
      if (get("automation")) fields.automation = get("automation");
      if (get("covers")) fields.covers = list(get("covers"));
    }
    if (type === "incident") {
      const severity = get("severity").toLowerCase();
      if (severity && !/^sev[1-4]$/.test(severity))
        return fail(`severity '${get("severity")}' is not sev1..sev4`);
      if (severity) fields.severity = severity;
      for (const t of ["started", "resolved_at"] as const) {
        if (get(t) && !DATETIME.test(get(t))) return fail(`${t} '${get(t)}' is not a date or time`);
        if (get(t)) fields[t] = get(t);
      }
      if (get("services")) fields.services = list(get("services"));
    }
    const roles = list(get("roles")).filter((r) => NAME.test(r));
    const tags = list(get("tags"))
      .map((t) => t.toLowerCase().replace(/\s+/g, "-"))
      .filter((t) => /^[a-z0-9][a-z0-9-]*$/.test(t));
    const paths = list(get("paths"));
    const extra = extraColumns
      .map((c) => [c, cellText(cells[cols.indexOf(c)])] as const)
      .filter(([, v]) => v);
    const table = extra.length
      ? ["| Column | Value |", "|---|---|", ...extra.map(([c, v]) => `| ${mdCell(c)} | ${mdCell(v)} |`)].join(
          "\n",
        )
      : "";
    const summaryText = get("summary");
    const section = (h: string, v: string) => `## ${h}\n\n${v || NOT_STATED}`;
    const body =
      type === "task"
        ? [
            section("Goal", summaryText),
            section("Acceptance criteria", ""),
            section("Notes", [get("notes"), table].filter(Boolean).join("\n\n")),
          ]
        : type === "testcase"
          ? [
              section("Preconditions", get("preconditions")),
              section("Steps", get("steps")),
              section("Expected", get("expected")),
              section("Last result", ""),
              ...(table ? [`## Other columns\n\n${table}`] : []),
            ]
          : [
              section("Impact", get("impact")),
              section(
                "Timeline",
                get("started")
                  ? `Started ${get("started")}${get("resolved_at") ? `; resolved ${get("resolved_at")}` : ""}.`
                  : "",
              ),
              section("Root cause", get("root_cause")),
              section("Fix", get("fix")),
              section("Prevention", ""),
              ...(table ? [`## Other columns\n\n${table}`] : []),
            ];
    const summary = (firstSentence(summaryText) || title).replace(/\n/g, " ").slice(0, 200);
    items.push({
      row,
      record: {
        type,
        title,
        summary,
        body: body.join("\n\n"),
        ...(status ? { status } : {}),
        ...(roles.length ? { roles } : {}),
        ...(tags.length ? { tags } : {}),
        ...(paths.length ? { paths } : {}),
        ...(Object.keys(fields).length ? { fields } : {}),
        mode: "template",
      },
    });
    return true;
  };
  data.forEach((cells, i) => {
    mapRow(cells, i);
  });
  return { type, items, errors, extraColumns };
}
