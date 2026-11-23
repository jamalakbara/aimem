import { STATUSES } from "@aimem/schema";
import { firstSentence } from "../adopt/markdown.js";
import type { DocumentRecord } from "./document.js";

/** A parsed CSV row; \`error\` is set when the row could not be read (its cells are empty). */
export type CsvRow = string[] & { error?: string };

/**
 * RFC 4180 CSV: quoted cells, doubled quotes, commas and newlines inside quotes, CRLF, a leading BOM.
 * A quote that never closes is an error for that row only; parsing resumes on the next line (QA, #100).
 */
export function parseCsv(text: string): CsvRow[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const rows: CsvRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const start = i;
    const row: string[] = [];
    let cell = "";
    let quoted = false;
    let line = lines[i] ?? "";
    let at = 0;
    let broken = false;
    for (;;) {
      if (at >= line.length) {
        if (!quoted) break;
        // Inside quotes the record continues on the next line.
        i++;
        if (i >= lines.length) {
          broken = true;
          break;
        }
        cell += "\n";
        line = lines[i] ?? "";
        at = 0;
        continue;
      }
      const ch = line[at];
      if (quoted) {
        if (ch === '"' && line[at + 1] === '"') {
          cell += '"';
          at++;
        } else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"' && cell === "") quoted = true;
      else if (ch === ",") {
        row.push(cell);
        cell = "";
      } else cell += ch;
      at++;
    }
    if (broken) {
      rows.push(Object.assign([] as string[], { error: "unterminated quoted cell" }));
      i = start + 1;
      continue;
    }
    row.push(cell);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    i++;
  }
  return rows;
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
  items: { row: number; key?: string; record: DocumentRecord & { paths?: string[] } }[];
  errors: { row: number; reason: string }[];
  /** Rows that imported, with something worth saying (missing or extra cells). */
  notes: { row: number; reason: string }[];
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
/** Spreadsheets store dates as day numbers since 1899-12-30; turn one into an ISO date or time. */
const fromSerial = (v: string, withTime: boolean, date1904 = false) => {
  if (!/^\d+(\.\d+)?$/.test(v)) return v;
  const n = Number(v);
  if (n < 1 || n > 2958465) return v;
  // 1904-based workbooks (old Mac Excel) count from 1904-01-01, 1462 days later (QA, #101).
  const base = Date.UTC(1899, 11, 30) + (date1904 ? 1462 * 86_400_000 : 0);
  const iso = new Date(base + Math.round(n * 86_400_000)).toISOString();
  return withTime && n % 1 !== 0 ? `${iso.slice(0, 19)}Z` : iso.slice(0, 10);
};
const DATETIME = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const NAME = /^[a-z0-9][a-z0-9_-]*$/i;

/**
 * 16 §4.1: one row = one record. Headers equal frontmatter field names (case-insensitive, spaces → _);
 * unknown columns go into the body as a small table. A bad row is reported with its sheet row number
 * (the header is row 1) and the other rows still import. Cells are text: nothing is evaluated.
 */
export function sheetToRecords(
  rows: string[][],
  fileName: string,
  typeHint?: string,
  opts: { padShortRows?: boolean; date1904?: boolean } = {},
): SheetResult {
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
  // An optional "key" column keys rows by value, so inserting or deleting rows does not shift them.
  const known = new Set([...SHEET_COLUMNS[kind], "key"]);
  const keyed = cols.includes("key");
  const seenKeys = new Map<string, number>();
  const extraColumns = cols.filter((c) => c && !known.has(c));
  const items: SheetResult["items"] = [];
  const errors: SheetResult["errors"] = [];
  const notes: SheetResult["notes"] = [];

  /** Maps one row; false when the row was reported as an error. */
  const mapRow = (cells: string[], i: number): boolean => {
    const row = i + 2;
    if ((cells as CsvRow).error) {
      errors.push({ row, reason: (cells as CsvRow).error ?? "unreadable row" });
      return false;
    }
    const get = (c: string) => {
      const at = cols.indexOf(c);
      const v = at < 0 ? "" : cellText(cells[at]);
      return c === "due"
        ? fromSerial(v, false, opts.date1904)
        : c === "started" || c === "resolved_at"
          ? fromSerial(v, true, opts.date1904)
          : v;
    };
    const fail = (reason: string): false => {
      errors.push({ row, reason });
      return false;
    };
    const title = get("title").replace(/\s+/g, " ").slice(0, 120);
    if (!title) return fail("title is empty");
    let key: string | undefined;
    if (keyed) {
      key = get("key");
      if (!key) return fail("key is empty");
      const first = seenKeys.get(key);
      if (first !== undefined) return fail(`key '${key}' is used by row ${first} too`);
      seenKeys.set(key, row);
    }
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
    // Same rule as claim paths (3.4a): relative to the repository, no '.' or '..' parts.
    if (
      paths.some((p) => /^([a-z]:|[\\/])/i.test(p) || p.split(/[\\/]/).some((x) => x === "." || x === ".."))
    )
      return fail("paths must be relative to the repository, without '.' or '..' parts");
    // Spreadsheet apps leave out empty cells at the end of a row: only CSV rows are short by mistake.
    if (cells.length < cols.length && !opts.padShortRows)
      notes.push({ row, reason: `has ${cells.length} cells, the header has ${cols.length}` });
    else if (cells.length > cols.length && cells.slice(cols.length).some((c) => c.trim()))
      notes.push({
        row,
        reason: `has ${cells.length} cells, the header has ${cols.length}; the extra cells were left out`,
      });
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
      ...(key !== undefined ? { key } : {}),
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
  return { type, items, errors, notes, extraColumns };
}
