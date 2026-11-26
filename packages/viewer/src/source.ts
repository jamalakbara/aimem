import type { IndexedRecord } from "@aimem/core";
import { safeExternalHref } from "./html.js";
import { systemLabel, T } from "./strings.js";

/** Where a record that the notebook does not own comes from (16 §2), and where it can be edited (24 §5.7). */

/** The systems that have a place to edit a document. An imported file has none, and an unknown system is not assumed to. */
const EDITABLE: ReadonlySet<string> = new Set(["google-doc", "google-sheet", "odoo"]);

export interface EditLink {
  href: string;
  /** Shown next to the link: the name of the system comes from the file, so the reader sees where it really leads. */
  host: string;
}

/**
 * The link of "Edit at source", only for a system that can be edited and an address that is written as
 * `https://…`, parses without a base, and has no user name or password. The parsed form is what is linked.
 */
export function editLink(system: unknown, url: unknown): EditLink | undefined {
  if (typeof system !== "string" || !EDITABLE.has(system)) return undefined;
  // The parser would also take `https:host`, back slashes and leading spaces.
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) return undefined;
  const href = safeExternalHref(url);
  return href?.startsWith("https://") ? { href, host: new URL(href).host } : undefined;
}

export interface ExternalSource {
  name: string;
  /** The row of a record that came from a sheet. */
  row?: string;
  edit?: EditLink;
}

function rowOf(row: unknown): string | undefined {
  if (typeof row === "number") return Number.isInteger(row) && row > 0 ? T.sheetRow(String(row)) : undefined;
  if (typeof row !== "string") return undefined;
  if (/^[1-9]\d*$/.test(row)) return T.sheetRow(row);
  return row.startsWith("key:") && row.length > 4 ? T.sheetKey(row.slice(4)) : undefined;
}

/** The source of an externally-owned record; a record the notebook owns, also after `detach`, has none. */
export function externalSource(r: IndexedRecord): ExternalSource | undefined {
  const source = r.fm.source;
  if (
    r.fm.managed_by !== "external" ||
    typeof source !== "object" ||
    source === null ||
    Array.isArray(source)
  )
    return undefined;
  const { system, url, row: at } = source as Record<string, unknown>;
  if (typeof system !== "string" || !system) return undefined;
  const row = rowOf(at);
  const edit = editLink(system, url);
  return { name: systemLabel(system), ...(row ? { row } : {}), ...(edit ? { edit } : {}) };
}
