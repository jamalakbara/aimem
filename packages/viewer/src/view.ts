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
export const recordHref = (project: string, id: string): string =>
  `${projectHref(project)}/r/${encodeURIComponent(id)}`;
