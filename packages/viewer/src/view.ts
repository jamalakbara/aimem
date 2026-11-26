import { filterRecords, type IndexedRecord } from "@aimem/core";
import type { Snapshot } from "./cache.js";

/** What a page needs. Pages are pure: they read this and return HTML. */
export interface ViewContext extends Snapshot {
  now: Date;
  /** The role lens of the dashboard and the lists (24 §5.6); never set for search or a record page. */
  lens?: string;
  /** The address asked for a lens that is not one of the choices. */
  lensIgnored?: boolean;
}

/**
 * The records a dashboard or a list shows: with a lens, those for that role or for `all`, in every status, so a
 * list stays the set of `aimem list`. Only what is listed is narrowed; links and duplicate ids use the whole index.
 */
export function shown(c: ViewContext): readonly IndexedRecord[] {
  return c.lens
    ? filterRecords(c.index.records, { roles: [c.lens], includeSuperseded: true })
    : c.index.records;
}

export interface Page {
  status: number;
  html: string;
}

/** The start of every address of a notebook; never with a query, because other addresses append to it. */
export const projectHref = (project: string): string => `/p/${encodeURIComponent(project)}`;
/** The dashboard, with the lens when there is one (24 §5.6). */
export const dashboardHref = (project: string, lens?: string): string =>
  `${projectHref(project)}${lens ? `?${new URLSearchParams({ lens })}` : ""}`;
/** Id of the one search form, in the header of every notebook page; filters belong to it by this id. */
export const SEARCH_FORM = "search";
export const searchHref = (project: string): string => `${projectHref(project)}/search`;
/** The segment of the import guide (24 §5.7), for the route and the links. */
export const GUIDE_SEGMENT = "import";
/** The guide lists nothing, but it keeps the lens so that the way back keeps it (24 §5.6). */
export const importHref = (project: string, lens?: string): string =>
  `${projectHref(project)}/${GUIDE_SEGMENT}${lens ? `?${new URLSearchParams({ lens })}` : ""}`;
export const recordHref = (project: string, id: string): string =>
  `${projectHref(project)}/r/${encodeURIComponent(id)}`;

/** Pages that list records, in the order of the header links. Only pages that exist belong here. */
export const SECTIONS = ["tasks", "decisions", "handoffs", "records"] as const;
export type Section = (typeof SECTIONS)[number];
/** The address of a list page; a parameter without a value, and the first page, are left out. Pass `lens` last. */
export function sectionHref(
  project: string,
  section: Section,
  params: Readonly<Record<string, string | number | undefined>> = {},
): string {
  const q = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === "" || (name === "page" && Number(value) <= 1)) continue;
    q.set(name, String(value));
  }
  const query = q.toString();
  return `${projectHref(project)}/${section}${query ? `?${query}` : ""}`;
}
