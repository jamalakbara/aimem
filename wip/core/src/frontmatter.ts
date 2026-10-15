import YAML from "yaml";

const DOC_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

export interface SplitResult { fm: Record<string, unknown> | null; body: string; error?: string }

export function splitDoc(text: string): SplitResult {
  const m = DOC_RE.exec(text.replace(/^﻿/, ""));
  if (!m) return { fm: null, body: text, error: "missing frontmatter" };
  try {
    const parsed = YAML.parse(m[1] ?? "");
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { fm: null, body: m[2] ?? "", error: "frontmatter is not a mapping" };
    }
    return { fm: parsed as Record<string, unknown>, body: (m[2] ?? "").replace(/^\r?\n/, "") };
  } catch (e) {
    return { fm: null, body: m[2] ?? "", error: `invalid YAML: ${(e as Error).message.split("\n")[0]}` };
  }
}

/** Canonical key order for known fields; unknown keys keep their relative order after them. */
const KEY_ORDER = [
  "aimem", "id", "type", "title", "summary", "status", "trust", "roles", "tags", "repo", "paths", "author",
  "created", "updated", "verified", "expires", "links", "supersedes", "superseded_by", "managed_by", "source", "evidence",
];

export function orderKeys(fm: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of KEY_ORDER) if (fm[k] !== undefined) out[k] = fm[k];
  for (const k of Object.keys(fm)) if (!(k in out) && fm[k] !== undefined) out[k] = fm[k];
  return out;
}

export function serializeDoc(fm: Record<string, unknown>, body: string): string {
  const y = YAML.stringify(orderKeys(fm), { lineWidth: 0 });
  return `---\n${y}---\n\n${body.replace(/^\s+|\s+$/g, "")}\n`;
}
