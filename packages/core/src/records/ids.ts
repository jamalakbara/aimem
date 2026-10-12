import { ID_ALPHABET, type RecordType, TYPE_PREFIX } from "@aimem/schema";
import type { Random } from "../ports.js";

/** `<prefix>-<8 Crockford base32 chars>` from injected randomness (03 §2.2). */
export function newId(type: RecordType, random: Random): string {
  const bytes = random.bytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += ID_ALPHABET[(bytes[i] ?? 0) % 32];
  return `${TYPE_PREFIX[type]}-${s}`;
}

const MAX_ATTEMPTS = 20;

/** A new id not present in `taken`. Collisions are astronomically rare; the cap guards broken randomness. */
export function newUniqueId(type: RecordType, random: Random, taken: ReadonlySet<string>): string {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const id = newId(type, random);
    if (!taken.has(id)) return id;
  }
  throw new Error(`could not generate a unique id after ${MAX_ATTEMPTS} attempts`);
}

const SLUG_MAX = 60;

/** Lowercase `a-z0-9-` from a title, max 60 chars; `untitled` when nothing usable remains (03 §2). */
export function slugify(title: string): string {
  const s = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");
  return s || "untitled";
}

/** `<id>-<slug>.md`; handoffs add the creation date: `<id>-<yyyymmdd>-<slug>.md` (03 §2, §3.4). */
export function recordFileName(fm: { id: string; type: RecordType; title: string; created: string }): string {
  const slug = slugify(fm.title);
  if (fm.type === "handoff") return `${fm.id}-${fm.created.slice(0, 10).replace(/-/g, "")}-${slug}.md`;
  return `${fm.id}-${slug}.md`;
}
