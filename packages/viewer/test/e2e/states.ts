import { IDS, P } from "./notebook.js";

/** One entry for each page type and state of the viewer. `main` is text that proves the state is the one meant. */
export interface State {
  name: string;
  path: string;
  status?: number;
  has: string;
}

export const STATES: readonly State[] = [
  { name: "dashboard", path: P, has: "Tasks in review" },
  // Without the lens there are handoffs, so none under `qa` shows that the lens is used.
  { name: "dashboard with a role lens", path: `${P}?lens=qa`, has: "Latest handoffs (0)" },
  { name: "dashboard with an ignored lens", path: `${P}?lens=nobody`, has: "was ignored" },
  { name: "search before a query", path: `${P}/search`, has: "Type a word" },
  { name: "search results, page 1", path: `${P}/search?q=zzpaged`, has: "28 results" },
  { name: "search results, page 2", path: `${P}/search?q=zzpaged&page=2`, has: "Showing 26–28 of 28" },
  { name: "search without a match", path: `${P}/search?q=qqqqnomatch&type=task`, has: "No matching records" },
  { name: "search with an ignored filter", path: `${P}/search?q=zzpaged&type=nothing`, has: "was ignored" },
  { name: "search for a reference", path: `${P}/search?q=${IDS.rich}`, has: `Open ${IDS.rich}` },
  { name: "search that finds hostile text", path: `${P}/search?q=zzhostile`, has: "zzhostile" },
  { name: "task board", path: `${P}/tasks`, has: "Other status" },
  { name: "tasks of one status", path: `${P}/tasks?status=review`, has: "Tasks in review" },
  { name: "tasks of one status, page 2", path: `${P}/tasks?status=open&page=2`, has: "Showing 26" },
  { name: "tasks with another status", path: `${P}/tasks?status=other`, has: "Task with a status outside" },
  { name: "decision timeline", path: `${P}/decisions`, has: "Replaces" },
  { name: "decisions of one status", path: `${P}/decisions?status=superseded`, has: "Replaced by" },
  { name: "decisions, empty filter", path: `${P}/decisions?status=other`, has: "No matching records" },
  { name: "handoff feed", path: `${P}/handoffs`, has: "Handoffs" },
  { name: "browse menu", path: `${P}/records`, has: "Browse by type" },
  ...(["decision", "task", "memory", "handoff", "incident", "runbook", "schema", "testcase"] as const).map(
    (type) => ({ name: `browse ${type}`, path: `${P}/records?type=${type}`, has: "Updated " }),
  ),
  { name: "import guide", path: `${P}/import`, has: "aimem import notes.md" },
  { name: "record: decision", path: `${P}/r/dec-1wwcakek`, has: "Details" },
  { name: "record: replaced decision", path: `${P}/r/dec-0b20v421`, has: "This record was replaced." },
  { name: "record: task", path: `${P}/r/${IDS.review}`, has: "In review" },
  { name: "record: memory with rich text", path: `${P}/r/${IDS.rich}`, has: "Wide table" },
  { name: "record: rich text as plain text", path: `${P}/r/${IDS.rich}?view=plain`, has: "Show formatted" },
  { name: "record: handoff", path: `${P}/r/hnd-3cntw4e1`, has: "Details" },
  { name: "record: incident", path: `${P}/r/inc-242wrkm4`, has: "Details" },
  { name: "record: runbook", path: `${P}/r/run-8hmkbbjd`, has: "May be out of date" },
  { name: "record: schema", path: `${P}/r/sch-3a3jkgmm`, has: "Details" },
  { name: "record: testcase from a file", path: `${P}/r/${IDS.upload}`, has: "Source: Imported file" },
  { name: "record: Google Doc, source missing", path: `${P}/r/${IDS.doc}`, has: "Edit at source" },
  { name: "record: Google Sheet row", path: `${P}/r/${IDS.sheet}`, has: "Source: Google Sheet, row 12" },
  { name: "record: unsafe source address", path: `${P}/r/${IDS.badUrl}`, has: "Source: Google Doc" },
  { name: "record: expired", path: `${P}/r/${IDS.expired}`, has: "Expired" },
  { name: "record: two files, one id", path: `${P}/r/${IDS.shared}`, has: "2 records share" },
  { name: "record: moved away", path: `${P}/r/${IDS.moved}`, has: "moved to repo:elsewhere" },
  { name: "record: too long to format", path: `${P}/r/${IDS.huge}`, has: "too long to format" },
  { name: "record: hostile text", path: `${P}/r/${IDS.hostile}`, has: "Hostile corpus" },
  { name: "record not found", path: `${P}/r/mem-00000000`, status: 404, has: "Record not found" },
  { name: "page not found", path: `${P}/nothing`, status: 404, has: "There is no page" },
];

/** The same lists with no records at all. */
export const EMPTY_STATES: readonly State[] = [
  { name: "empty dashboard", path: P, has: "No records yet" },
  { name: "empty search", path: `${P}/search?q=anything`, has: "No records yet" },
  { name: "empty task board", path: `${P}/tasks`, has: "No tasks yet" },
  { name: "empty decisions", path: `${P}/decisions`, has: "No decisions yet" },
  { name: "empty handoffs", path: `${P}/handoffs`, has: "No handoffs yet" },
  { name: "empty browse menu", path: `${P}/records`, has: "Browse by type" },
  { name: "empty list of one type", path: `${P}/records?type=incident`, has: "No incidents yet" },
  { name: "empty import guide", path: `${P}/import`, has: "aimem import notes.md" },
];
