import type { IndexedRecord, SearchOptions } from "@aimem/core";
import { RECORD_TYPES, STATUSES, TRUST_LEVELS } from "@aimem/schema";
import { cut } from "./html.js";

/** Characters of a query that are used (24 §5.3). */
export const MAX_QUERY = 200;
export const PAGE_SIZE = 25;
const MAX_ROLES = 50;
/** As imports accept them, but short, so that the longest address of the form stays under the guard's limit. */
const ROLE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;

export const ALL_STATUSES: readonly string[] = [...new Set<string>(Object.values(STATUSES).flat())];

/** The roles that can be picked. `all` is not one: such records match every role. */
export function roleChoices(records: readonly IndexedRecord[]): string[] {
  const found = new Set(records.flatMap((r) => r.roles.filter((x) => x !== "all" && ROLE.test(x))));
  return [...found].sort().slice(0, MAX_ROLES);
}

/** The roles a lens can be: those of `project.yaml` in their order, then those that records use (24 §5.6). */
export function lensChoices(
  nb: { config: { roles?: readonly string[] } },
  records: readonly IndexedRecord[],
): string[] {
  const listed = (nb.config.roles ?? []).filter((r) => r !== "all" && ROLE.test(r));
  const out = [...new Set(listed)];
  for (const r of roleChoices(records)) if (!out.includes(r)) out.push(r);
  return out.slice(0, MAX_ROLES);
}

/** The lens of an address. Empty means none; `all` and anything else that is not a choice is reported, not used. */
export const readLens = (p: URLSearchParams, choices: readonly string[]) => readChoice(p, "lens", choices);

/** A page number from an address: at least 1, anything else counts as 1. It may be past the end. */
export function readPage(p: URLSearchParams): number {
  const page = p.get("page") ?? "";
  return /^[1-9]\d*$/.test(page) ? Number(page) : 1;
}

/** One of the allowed values, as written. `unknown` is set when something else was given (not for an empty value). */
export function readChoice<T extends string>(
  p: URLSearchParams,
  name: string,
  allowed: readonly T[],
): { value?: T; unknown: boolean } {
  const given = p.get(name);
  const value = allowed.find((v) => v === given);
  return { ...(value !== undefined ? { value } : {}), unknown: Boolean(given) && value === undefined };
}

export interface Query {
  q: string;
  /** The address had more characters than are used. */
  cutOff: boolean;
  type?: string;
  status?: string;
  trust?: string;
  role?: string;
  closed: boolean;
  /** A filter in the address is not one of the choices. */
  ignored: boolean;
  /** At least 1; may be past the end. */
  page: number;
}

/** Reads an address. Anything unknown is left out (an unknown filter is reported), and the first of a repeated parameter counts. */
export function readQuery(p: URLSearchParams, roles: readonly string[]): Query {
  // A pasted tab separates words like a space, and would only show in the box and the links.
  const raw = (p.get("q") ?? "").replaceAll("\t", " ");
  const q = cut(raw, MAX_QUERY);
  const pick = (name: string, allowed: readonly string[]) => allowed.find((v) => v === p.get(name));
  const type = pick("type", RECORD_TYPES);
  const status = pick("status", ALL_STATUSES);
  const trust = pick("trust", TRUST_LEVELS);
  const role = pick("role", roles);
  const unknown = (name: string, found: string | undefined) => Boolean(p.get(name)) && !found;
  return {
    q,
    cutOff: q !== raw,
    ...(type ? { type } : {}),
    ...(status ? { status } : {}),
    ...(trust ? { trust } : {}),
    ...(role ? { role } : {}),
    closed: p.get("closed") === "1",
    ignored:
      unknown("type", type) || unknown("status", status) || unknown("trust", trust) || unknown("role", role),
    page: readPage(p),
  };
}

/** The address of a page of these results; filters that are not set are left out. */
export function writeQuery(x: Query, page: number): string {
  const p = new URLSearchParams({ q: x.q });
  for (const name of ["type", "status", "trust", "role"] as const) {
    const v = x[name];
    if (v) p.set(name, v);
  }
  if (x.closed) p.set("closed", "1");
  if (page > 1) p.set("page", String(page));
  return p.toString();
}

export const hasFilters = (x: Query): boolean => Boolean(x.type || x.status || x.trust || x.role || x.closed);

/** Options for `search()`. Trust is not one of them; it is applied to the hits (24 §5.3). */
export const searchOptions = (x: Query): SearchOptions => ({
  limit: Number.POSITIVE_INFINITY,
  ...(x.type ? { types: [x.type] } : {}),
  ...(x.status ? { statuses: [x.status] } : {}),
  ...(x.role ? { roles: [x.role] } : {}),
  ...(x.closed ? { includeSuperseded: true } : {}),
});
