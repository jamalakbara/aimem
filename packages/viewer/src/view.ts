import type { Snapshot } from "./cache.js";

/** What a page needs. Pages are pure: they read this and return HTML. */
export interface ViewContext extends Snapshot {
  now: Date;
}

export interface Page {
  status: number;
  html: string;
}

export const projectHref = (project: string): string => `/p/${encodeURIComponent(project)}`;
/** Id of the one search form, in the header of every notebook page; filters belong to it by this id. */
export const SEARCH_FORM = "search";
export const searchHref = (project: string): string => `${projectHref(project)}/search`;
export const recordHref = (project: string, id: string): string =>
  `${projectHref(project)}/r/${encodeURIComponent(id)}`;

/** Pages that list records, in the order of the header links. Only pages that exist belong here. */
export const SECTIONS = ["tasks"] as const;
export type Section = (typeof SECTIONS)[number];
/** The address of a list page; a parameter without a value, and the first page, are left out. */
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
