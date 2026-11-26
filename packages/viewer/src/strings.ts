/** Every text of the interface (10 §7: English only in v1, strings in one place). */

const TYPES: ReadonlyMap<string, string> = new Map([
  ["decision", "Decision"],
  ["task", "Task"],
  ["memory", "Memory"],
  ["handoff", "Handoff"],
  ["incident", "Incident"],
  ["runbook", "Runbook"],
  ["schema", "Schema"],
  ["testcase", "Test case"],
]);
const TRUST: ReadonlyMap<string, string> = new Map([
  ["verified", "Verified"],
  ["agent", "Not verified: written by an agent"],
  ["inferred", "Not verified: inferred draft"],
]);
const SYSTEMS: ReadonlyMap<string, string> = new Map([
  ["google-doc", "Google Doc"],
  ["google-sheet", "Google Sheet"],
  ["upload", "Imported file"],
  ["odoo", "Odoo"],
]);
export const FRESHNESS = { stale: "May be out of date", expired: "Expired" } as const;

const sentence = (s: string) => {
  const words = s.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};
export const typeLabel = (type: string): string => TYPES.get(type) ?? sentence(type);
export const statusLabel = (status: string): string => (status === "review" ? "In review" : sentence(status));
/** Only a known `verified` may read as verified; the date is shown only then. */
export const trustLabel = (trust: string, verified?: unknown): string =>
  trust === "verified" && typeof verified === "string" && verified
    ? `Verified on ${dateLabel(verified)}`
    : (TRUST.get(trust) ?? `Not verified: ${trust}`);
/** Short name of a trust level, for a choice in a list. */
export const trustName = (trust: string): string =>
  trust === "agent" ? "Written by an agent" : trust === "inferred" ? "Inferred draft" : sentence(trust);
/** A column of the task board, and the heading of the list of one status. */
export const columnLabel = (status: string): string =>
  status === "other" ? T.otherStatus : statusLabel(status);
const TASKS_BY_STATUS: ReadonlyMap<string, string> = new Map([
  ["open", "Open tasks"],
  ["in_progress", "Tasks in progress"],
  ["blocked", "Blocked tasks"],
  ["review", "Tasks in review"],
  ["done", "Done tasks"],
  ["cancelled", "Cancelled tasks"],
  ["other", "Tasks with another status"],
]);
const PLURAL: ReadonlyMap<string, string> = new Map([
  ["decision", "Decisions"],
  ["task", "Tasks"],
  ["memory", "Memories"],
  ["handoff", "Handoffs"],
  ["incident", "Incidents"],
  ["runbook", "Runbooks"],
  ["schema", "Schemas"],
  ["testcase", "Test cases"],
]);
export const typePlural = (type: string): string => PLURAL.get(type) ?? `${sentence(type)}s`;
/** "Accepted decisions", "Decisions with another status", or just "Decisions". */
export const listHeading = (plural: string, status?: string): string =>
  status === undefined
    ? plural
    : status === "other"
      ? `${plural} with another status`
      : `${columnLabel(status)} ${plural.toLowerCase()}`;
/** `sev2` as `Sev 2`; anything else is not shown. */
export const severityLabel = (severity: unknown): string | undefined => {
  const m = typeof severity === "string" ? /^sev([1-4])$/.exec(severity) : null;
  return m ? `Sev ${m[1]}` : undefined;
};
export const tasksHeading = (status: string): string => TASKS_BY_STATUS.get(status) ?? "Tasks";
/** The link under a full column. It ends as the heading of the list it opens, so it can be read on its own. */
/** "View all 16 open tasks", or "View 1 open task": one is not "all". */
export const viewAllTasks = (status: string, n: number): string =>
  n === 1
    ? `View 1 ${tasksHeading(status).toLowerCase().replace("tasks", "task")}`
    : `View all ${n} ${tasksHeading(status).toLowerCase()}`;
export const systemLabel = (system: string): string => SYSTEMS.get(system) ?? system;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** `2026-10-11T09:00:00Z` as `11 Oct 2026` (UTC, so it matches the file); other text unchanged. */
export function dateLabel(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month} ${m[1]}` : value;
}

export const T = {
  app: "aimem",
  skip: "Skip to content",
  readOnly: "Read-only",
  search: "Search",
  searchRecords: "Search records",
  filters: "Filters",
  trust: "Verification",
  role: "Role",
  any: "All",
  includeClosed: "Include closed",
  apply: "Apply filters",
  clearFilters: "Clear filters",
  typeAWord: "Type a word to search this notebook.",
  noMatch: "No matching records",
  wholeWords: "Search matches whole words. Try a different word or spelling.",
  keywordOnly: "Keyword search, so the order can differ from aimem search.",
  filterIgnored: "A filter in the address is not one of the choices, so it was ignored.",
  queryCut: "Only the first 200 characters were used.",
  results: (n: number, q: string) => `${n} result${n === 1 ? "" : "s"} for “${q}”`,
  showing: (a: number, b: number, n: number) => `Showing ${a}–${b} of ${n}.`,
  page: (n: number) => `page ${n}`,
  pages: "Pages",
  previous: "Previous",
  next: "Next",
  open: (ref: string) => `Open ${ref}`,
  movedTo: (to: string) => `Moved to ${to}`,
  sections: "Sections",
  lensShown: (role: string) => `Role: ${role}`,
  allRoles: "Show all roles",
  allRolesOption: "All roles",
  lensHint:
    "Filters the dashboard and lists. Records for all roles are always included. Search still covers the whole notebook.",
  applyLens: "Apply",
  /** "View all 6 decisions", or "View 1 decision". */
  viewAll: (n: number, plural: string, singular: string) =>
    n === 1 ? `View 1 ${singular.toLowerCase()}` : `View all ${n} ${plural.toLowerCase()}`,
  tasksInReview: "Tasks in review",
  recentDecisions: "Recent decisions",
  latestHandoffs: "Latest handoffs",
  noTasksInReview: "No tasks in review",
  tasks: "Tasks",
  decisions: "Decisions",
  handoffs: "Handoffs",
  browse: "Browse",
  browseByType: "Browse by type",
  noneYet: (plural: string) => `No ${plural.toLowerCase()} yet`,
  replaces: "Replaces",
  replacedBy: "Replaced by",
  taskOfHandoff: "Task",
  branch: "Branch",
  updated: (date: string) => `Updated ${date}`,
  started: (date: string) => `Started ${date}`,
  noTasks: "No tasks yet",
  noTasksInColumn: "No tasks",
  otherStatus: "Other status",
  shownOf: (shown: number, n: number) => `Showing ${shown} of ${n}`,
  withCount: (label: string, n: number) => `${label} (${n})`,
  priority: "Priority",
  blockedBy: (n: number) => `Blocked by ${n} task${n === 1 ? "" : "s"}`,
  due: (date: string) => `Due ${date}`,
  titled: (heading: string, n: number) => `${heading}: ${n}`,
  records: (n: number) => `${n} record${n === 1 ? "" : "s"}`,
  byStatus: "Records by type and status",
  type: "Type",
  status: "Status",
  count: "Count",
  none: "No records yet",
  unreviewed: "Not reviewed by a person yet",
  agent: "Agent-written",
  inferred: "Inferred",
  latestHandoff: "Latest handoff",
  notices: "Notices",
  notShown: (n: number) => `${n} file${n === 1 ? " is" : "s are"} not shown`,
  more: (n: number) => `and ${n} more`,
  errors: {
    404: "Page not found",
    500: "Something went wrong",
    503: "The notebook cannot be read right now",
  } as Record<number, string>,
  tryAgain:
    "Try again in a moment. If this stays, stop and restart aimem serve web; aimem validate shows what is wrong with the files.",
  failed: "This page could not be shown. The other pages still work.",
  missing: "There is no page at this address.",
  home: "Back to the dashboard",
  recordNotFound: "Record not found",
  recordNotFoundHint: "No record in this notebook has that reference.",
  copyRef: "Copy reference",
  copied: "Copied",
  copyFailed: "Copy failed",
  showPlain: "Show as plain text",
  showFormatted: "Show formatted",
  tooLong: "This text is too long to format, so it is shown as plain text.",
  cut: "Only the first part is shown. Open the file to read the rest.",
  renderFailed: "This text could not be formatted. It is shown as plain text.",
  emptyBody: "This record has no text.",
  replaced: "This record was replaced.",
  details: "Details",
  links: "Linked records",
  notHere: "not in this notebook",
  moved: (to: string) => `This record moved to ${to}, which is not available on this computer.`,
  source: (from: string) => `Source: ${from}`,
  sheetRow: (row: string) => `row ${row}`,
  sheetKey: (key: string) => `row with key ${key}`,
  editAtSource: "Edit at source",
  opens: (host: string) => `Opens ${host}`,
  importLink: "How to import documents",
  sharedRest: (n: number) =>
    `${n} more ${n === 1 ? "record is" : "records are"} not shown. Run aimem validate.`,
  shared: (n: number, id: string) => `${n} records share ${id}`,
  sourceGone: "The source was missing or could not be read at the last sync.",
};

/** One paragraph, or command lines to type, of the import guide. */
type Block = { text: string } | { commands: readonly string[] };
const text = (t: string): Block => ({ text: t });
const run = (...commands: string[]): Block => ({ commands });

/** The import guide (24 decision 3). A test runs every command, so they stay those of the CLI. */
export const GUIDE: {
  title: string;
  intro: string;
  visible: string;
  sections: readonly { heading: string; blocks: readonly Block[] }[];
} = {
  title: "Import documents",
  intro:
    "This viewer is read-only: nothing is uploaded here. Documents and sheets are added with the aimem command line, run in the project folder. If you do not use a terminal, ask a teammate who does.",
  visible: "Imported content is visible to everyone who can read this repository.",
  sections: [
    {
      heading: "Import a file",
      blocks: [
        text(
          "A document (.md, .markdown, .txt, .docx or .pdf) becomes one record. A sheet (.csv or .xlsx) becomes one record for each row. A file can be at most 10 MB.",
        ),
        run("aimem import notes.md"),
        text(
          "Importing the same file again updates its record. A file that seems to contain a password or key is refused, and nothing is written.",
        ),
      ],
    },
    {
      heading: "Start a sheet from a template",
      blocks: [
        run("aimem templates list", "aimem templates export tasks --format csv --out tasks.csv"),
        text(
          "Fill in one task on each row, then import the sheet. For an Excel workbook, --sheet <name> picks the worksheet.",
        ),
        run("aimem import tasks.csv --as tasks"),
      ],
    },
    {
      heading: "Google Docs and Sheets",
      blocks: [
        text(
          "This needs a Google service account. Keep its key file outside the project, set AIMEM_GOOGLE_CREDENTIALS to its path, and share the folder or document with the service account.",
        ),
        text(
          "Choose the folder to read. A person does this, not an agent. For a single document, use --file instead of --folder.",
        ),
        run("aimem sources add google --folder <folder-id>", "aimem sources status"),
        text("Look at what would change, then sync."),
        run("aimem sources sync --dry-run", "aimem sources sync"),
        text(
          "Two people who sync the same documents on separate branches get merge conflicts, so let one person sync, or pull before you sync.",
        ),
        text("To see the sources, or to stop reading from Google (the records stay):"),
        run("aimem sources list", "aimem sources remove google"),
      ],
    },
    {
      heading: "Change an imported record",
      blocks: [
        text(
          "Change the document where it came from, then import or sync again. Where aimem has a web address for it, the record page has Edit at source.",
        ),
        text("To edit a record in aimem from now on, detach it. Updates from its source then stop."),
        run("aimem detach <ref>"),
      ],
    },
  ],
};
