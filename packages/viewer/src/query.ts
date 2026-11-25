import type { IndexedRecord, SearchOptions } from "@aimem/core";
import { RECORD_TYPES, STATUSES, TRUST_LEVELS } from "@aimem/schema";
import { cut } from "./html.js";

/** Characters of a query that are used (24 §5.3). */
export const MAX_QUERY = 200;
export const PAGE_SIZE = 25;
const MAX_ROLES = 50;
/** Short and plain, so that the longest address of the form stays under the guard's limit. */
const ROLE = /^[a-z0-9-]{1,32}$/;

export const ALL_STATUSES: readonly string[] = [...new Set<string>(Object.values(STATUSES).flat())];

/** The roles that can be picked. `all` is not one: such records match every role. */
export function roleChoices(records: readonly IndexedRecord[]): string[] {
  const found = new Set(records.flatMap((r) => r.roles.filter((x) => x !== "all" && ROLE.test(x))));
  return [...found].sort().slice(0, MAX_ROLES);
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
  /** At least 1; may be past the end. */
  page: number;
}

/** Reads an address. Anything unknown is left out, and the first of a repeated parameter counts. */
export function readQuery(p: URLSearchParams, roles: readonly string[]): Query {
  const raw = p.get("q") ?? "";
  const q = cut(raw, MAX_QUERY);
  const pick = (name: string, allowed: readonly string[]) => allowed.find((v) => v === p.get(name));
  const type = pick("type", RECORD_TYPES);
  const status = pick("status", ALL_STATUSES);
  const trust = pick("trust", TRUST_LEVELS);
  const role = pick("role", roles);
  const page = p.get("page") ?? "";
  return {
    q,
    cutOff: q !== raw,
    ...(type ? { type } : {}),
    ...(status ? { status } : {}),
    ...(trust ? { trust } : {}),
    ...(role ? { role } : {}),
    closed: p.get("closed") === "1",
    page: /^[1-9]\d*$/.test(page) ? Number(page) : 1,
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
