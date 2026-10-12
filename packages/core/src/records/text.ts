import YAML, { type Document, isMap, isScalar, type Node, type Pair, visit } from "yaml";

/**
 * A parsed record. Edits splice only the affected `key: value` lines into the original
 * frontmatter text, so unknown keys, key order, comments and formatting survive (03 §10).
 */
export interface RecordText {
  /** Frontmatter as plain data. Read-only view; change it through setField/deleteField. */
  readonly data: Record<string, unknown>;
  /** Body without leading/trailing whitespace. */
  readonly body: string;
  /** @internal frontmatter YAML source, LF line endings, ends with a newline unless empty. */
  yaml: string;
}

export type ParseResult = { ok: true; record: RecordText } | { ok: false; code: "V001"; message: string };

const STRINGIFY = { lineWidth: 0, flowCollectionPadding: false } as const;

/** Known keys in spec order (03 §2.1); other keys follow in insertion order. */
const KEY_ORDER = [
  "aimem",
  "id",
  "type",
  "title",
  "summary",
  "status",
  "trust",
  "roles",
  "tags",
  "repo",
  "paths",
  "author",
  "created",
  "updated",
  "verified",
  "links",
  "supersedes",
  "superseded_by",
  "expires",
  "external",
  "managed_by",
  "source",
  "evidence",
];

function fail(message: string): ParseResult {
  return { ok: false, code: "V001", message };
}

function parseYaml(yaml: string): { doc: Document; data: Record<string, unknown> } | string {
  const doc = YAML.parseDocument(yaml);
  if (doc.errors.length) return `invalid YAML: ${doc.errors[0]?.message.split("\n")[0]}`;
  if (!isMap(doc.contents)) return "frontmatter is not a mapping";
  return { doc, data: doc.toJS() as Record<string, unknown> };
}

/** Parse record text. CRLF and a leading BOM are accepted and normalised away. */
export function parseRecordText(input: string): ParseResult {
  const text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!text.startsWith("---\n")) return fail("missing frontmatter (file must start with ---)");
  const rest = text.slice(4);
  const close = /^---[ \t]*(?:\n|$)/m.exec(rest);
  if (!close) return fail("frontmatter is not closed with ---");
  const yaml = rest.slice(0, close.index);
  const parsed = parseYaml(yaml);
  if (typeof parsed === "string") return fail(parsed);
  const body = rest.slice(close.index + close[0].length).trim();
  return { ok: true, record: { data: parsed.data, body, yaml } };
}

/** Record text with LF endings: frontmatter, a blank line, the body, a final newline. */
export function serializeRecord(rec: RecordText): string {
  return `---\n${rec.yaml}---\n${rec.body ? `\n${rec.body}\n` : ""}`;
}

/** Collections of scalars are written in flow style (`[a, b]`), matching hand-written records. */
function styleCollections(doc: Document): void {
  visit(doc, {
    Seq(_, node) {
      if (node.items.every((i) => isScalar(i))) node.flow = true;
    },
  });
}

function renderPairs(entries: [string, unknown][]): string {
  const doc = new YAML.Document(Object.fromEntries(entries));
  styleCollections(doc);
  return entries.length ? doc.toString(STRINGIFY) : "";
}

/** A new record. Known keys in spec order, then the rest in the given order. */
export function createRecord(fields: Record<string, unknown>, body: string): RecordText {
  const known = KEY_ORDER.filter((k) => k in fields).map((k) => [k, fields[k]] as [string, unknown]);
  const other = Object.entries(fields).filter(([k]) => !KEY_ORDER.includes(k));
  const yaml = renderPairs([...known, ...other]);
  return reparse({ yaml, body: body.trim(), data: {} });
}

function reparse(rec: { yaml: string; body: string; data: Record<string, unknown> }): RecordText {
  const parsed = parseYaml(rec.yaml);
  if (typeof parsed === "string") throw new Error(`internal: edit produced invalid frontmatter (${parsed})`);
  return Object.assign(rec, { data: parsed.data });
}

/** Byte span [start, end) of a top-level pair: from the key's line start through the end of its value's last line. */
function pairSpan(yaml: string, key: string): [number, number] | undefined {
  const doc = YAML.parseDocument(yaml);
  if (!isMap(doc.contents)) return undefined;
  const pair = doc.contents.items.find((p: Pair) => isScalar(p.key) && String(p.key.value) === key);
  if (!pair) return undefined;
  const keyNode = pair.key as Node;
  const last = (pair.value as Node | null)?.range ?? keyNode.range;
  if (!keyNode.range || !last) return undefined;
  const start = yaml.lastIndexOf("\n", keyNode.range[0] - 1) + 1;
  const endAt = last[2];
  const end =
    yaml[endAt - 1] === "\n"
      ? endAt
      : yaml.indexOf("\n", endAt) === -1
        ? yaml.length
        : yaml.indexOf("\n", endAt) + 1;
  return [start, end];
}

function mutable(rec: RecordText): { yaml: string; body: string; data: Record<string, unknown> } {
  return rec as { yaml: string; body: string; data: Record<string, unknown> };
}

/** Set a top-level frontmatter key. Existing keys keep their position; new keys go last. */
export function setField(rec: RecordText, key: string, value: unknown): void {
  const r = mutable(rec);
  const line = renderPairs([[key, value]]);
  const span = pairSpan(r.yaml, key);
  r.yaml = span ? r.yaml.slice(0, span[0]) + line + r.yaml.slice(span[1]) : r.yaml + line;
  reparse(r);
}

/** Remove a top-level frontmatter key, leaving every other line untouched. */
export function deleteField(rec: RecordText, key: string): void {
  const r = mutable(rec);
  const span = pairSpan(r.yaml, key);
  if (!span) return;
  r.yaml = r.yaml.slice(0, span[0]) + r.yaml.slice(span[1]);
  reparse(r);
}

/** Replace the body; surrounding whitespace is dropped. */
export function setBody(rec: RecordText, body: string): void {
  mutable(rec).body = body.trim();
}
