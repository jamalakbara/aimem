import { RECORD_TYPES, type RecordType, TYPE_PREFIX } from "./constants.js";

/** 03 §2.2: Crockford base32, lowercase. */
export const ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

const PREFIXES = RECORD_TYPES.map((t) => TYPE_PREFIX[t]).join("|");
const ID_BODY = `(?:${PREFIXES})-[0-9a-hjkmnp-tv-z]{8}`;
export const PROJECT_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ID_RE = new RegExp(`^${ID_BODY}$`);
/** Local ref (`dec-…`) or global ref (`<project>:dec-…`). */
export const REF_RE = new RegExp(`^(?:[a-z0-9]+(?:-[a-z0-9]+)*:)?${ID_BODY}$`);

export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}

export function typeFromId(id: string): RecordType | undefined {
  if (!isValidId(id)) return undefined;
  const prefix = id.slice(0, 3);
  return RECORD_TYPES.find((t) => TYPE_PREFIX[t] === prefix);
}

export interface Ref {
  project?: string;
  id: string;
}

export function parseRef(ref: string): Ref {
  const i = ref.indexOf(":");
  return i < 0 ? { id: ref } : { project: ref.slice(0, i), id: ref.slice(i + 1) };
}
