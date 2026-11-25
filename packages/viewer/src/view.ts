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
