import { createHash } from "node:crypto";
import type { IndexedRecord } from "../index/build.js";

/** Bumped when chunking changes; any change forces a full vector rebuild (15 §4.3). */
export const CHUNKER_VERSION = 1;
const MAX_CHARS = 300 * 4; // ~300 tokens
const OVERLAP_CHARS = 40 * 4; // ~40 tokens

export interface Chunk {
  ref: string;
  /** `head`, a `##` section title, or `body` for records without sections. */
  section: string;
  /** Index of the part within a split section. */
  part: number;
  /** Text actually embedded, prefixed with its context. */
  text: string;
  /** Short hash of the record body; part of the cache key. */
  bodySha: string;
}

function split(text: string): string[] {
  if (text.length <= MAX_CHARS) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  const parts: string[] = [];
  let start = 0;
  while (start < words.length) {
    let end = start;
    let len = 0;
    while (end < words.length && len + (words[end]?.length ?? 0) + 1 <= MAX_CHARS)
      len += (words[end++]?.length ?? 0) + 1;
    if (end === start) end++; // a single over-long word
    parts.push(words.slice(start, end).join(" "));
    if (end >= words.length) break;
    let back = end;
    let overlap = 0;
    while (back > start + 1 && overlap < OVERLAP_CHARS) overlap += (words[--back]?.length ?? 0) + 1;
    start = back;
  }
  return parts;
}

/** Head chunk plus one chunk per `##` section, long sections split with overlap (15 §3). */
export function chunkRecord(r: IndexedRecord): Chunk[] {
  const bodySha = createHash("sha256").update(r.body).digest("hex").slice(0, 16);
  const head = [
    `${r.type} | ${r.title} — ${r.summary}`,
    r.tags.length ? `tags: ${r.tags.join(", ")}` : "",
    r.paths.length ? `paths: ${r.paths.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
  const chunks: Chunk[] = [{ ref: r.id, section: "head", part: 0, text: head, bodySha }];
  const sections: { title: string; text: string }[] = [];
  const re = /^##\s+(.+?)\s*$/gm;
  const marks = [...r.body.matchAll(re)];
  const preamble = (marks.length ? r.body.slice(0, marks[0]?.index) : r.body).trim();
  if (preamble) sections.push({ title: "body", text: preamble });
  marks.forEach((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = marks[i + 1]?.index ?? r.body.length;
    const text = r.body.slice(start, end).trim();
    if (text) sections.push({ title: m[1] ?? "section", text });
  });
  for (const s of sections) {
    const prefix = `${r.type} | ${r.title} | ${s.title === "body" ? "" : `## ${s.title}`}`.replace(
      / \| $/,
      "",
    );
    split(s.text).forEach((part, i) => {
      chunks.push({ ref: r.id, section: s.title, part: i, text: `${prefix}\n${part}`, bodySha });
    });
  }
  return chunks;
}
