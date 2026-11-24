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
]);
export const FRESHNESS = { fresh: "Up to date", stale: "May be out of date", expired: "Expired" } as const;

const sentence = (s: string) => {
  const words = s.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};
export const typeLabel = (type: string): string => TYPES.get(type) ?? sentence(type);
export const statusLabel = (status: string): string => sentence(status);
/** Only a known `verified` may read as verified. */
export const trustLabel = (trust: string): string => TRUST.get(trust) ?? `Not verified: ${trust}`;
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
  tryAgain: "Try again in a moment. aimem validate shows what is wrong.",
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
  shared: (n: number, id: string) => `${n} records share ${id}`,
  sourceGone: "The source was missing or could not be read at the last sync.",
};
