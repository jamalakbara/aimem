import { join } from "node:path";
import {
  BODY_SECTIONS,
  DEFAULT_STATUS,
  type RecordType,
  recordSchema,
  STATUSES,
  TYPE_DIR,
} from "@aimem/schema";
import { AimemError } from "../errors.js";
import { type IndexedRecord, loadIndex, type NotebookIndex } from "../index/build.js";
import type { Clock, Fs, Random } from "../ports.js";
import type { Notebook } from "../project/load.js";
import { newUniqueId, recordFileName } from "../records/ids.js";
import { readRecordFile, writeFileAtomic, writeRecordFile } from "../records/store.js";
import {
  createRecord,
  deleteField,
  type RecordText,
  serializeRecord,
  setBody,
  setField,
} from "../records/text.js";
import { writeIndexMd } from "../render/index-md.js";
import { tokenize } from "../search/bm25.js";
import { HIDDEN_STATUSES } from "../search/search.js";
import { scanSecrets } from "../secrets/scan.js";
import { RETIRED_STATUSES } from "../validate/validate.js";

export interface WriteDeps {
  fs: Fs;
  clock: Clock;
  random: Random;
}

export interface WriteResult {
  ref: string;
  /** Path of the main record, relative to the notebook root. */
  file: string;
  /** Every file written, relative to the notebook root. */
  changed: string[];
  warnings: string[];
}

const AUTHOR_RE = /^(?:human|agent):[^\s:]+(?::\S+)?$/;
const iso = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;
const day = (d: Date) => d.toISOString().slice(0, 10);

/** 04 §1: `--author` → `AIMEM_AUTHOR` (git `user.name` fallback arrives with slice 1.4c). */
export function resolveAuthor(input: { flag?: string; env: Record<string, string | undefined> }): string {
  const author = input.flag ?? input.env.AIMEM_AUTHOR;
  if (!author)
    throw new AimemError(
      "USAGE",
      "no author: pass --author human:<handle> or agent:<tool>, or set AIMEM_AUTHOR",
    );
  if (!AUTHOR_RE.test(author))
    throw new AimemError(
      "USAGE",
      `author must look like human:<handle> or agent:<tool>[:<model>] (got '${author}')`,
    );
  return author;
}

/** Body skeleton per type with TODO markers (03 §3). */
export function bodyTemplate(type: RecordType): string {
  const sections = BODY_SECTIONS[type];
  return sections.length
    ? sections.map((h) => `## ${h}\nTODO`).join("\n\n")
    : "TODO: state the fact first, then why we know it and how to verify it.";
}

function localId(ref: string, project: string): string | undefined {
  const i = ref.indexOf(":");
  if (i < 0) return ref;
  return ref.slice(0, i) === project ? ref.slice(i + 1) : undefined;
}

function find(nb: Notebook, index: NotebookIndex, ref: string): IndexedRecord {
  const id = localId(ref, nb.config.project);
  const rec = id ? index.records.find((r) => r.id === id) : undefined;
  if (!rec) throw new AimemError("NOT_FOUND", `record ${ref} not found`);
  return rec;
}

function checkLinks(nb: Notebook, index: NotebookIndex, refs: string[]): void {
  for (const ref of refs) {
    const id = localId(ref, nb.config.project);
    if (id !== undefined && !index.records.some((r) => r.id === id))
      throw new AimemError("INVALID_RECORD", `link target ${ref} not found`);
  }
}

function checkSchema(data: Record<string, unknown>): void {
  const parsed = recordSchema.safeParse(data);
  if (!parsed.success) {
    throw new AimemError(
      "INVALID_RECORD",
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
    );
  }
}

function checkSecrets(text: string): void {
  const findings = scanSecrets(text);
  if (findings.length) {
    throw new AimemError(
      "SECRET_DETECTED",
      `possible secret (${[...new Set(findings.map((f) => f.kind))].join(", ")}) on line ${findings.map((f) => f.line).join(", ")}; remove it and retry`,
      {
        findings,
      },
    );
  }
}

const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
};

/** A current record of the same type whose title (or title + summary) is very similar. */
export function findLikelyDuplicate(
  index: NotebookIndex,
  type: RecordType,
  title: string,
  summary: string,
  except?: string,
): IndexedRecord | undefined {
  const t = new Set(tokenize(title));
  const ts = new Set(tokenize(`${title} ${summary}`));
  return index.records.find(
    (r) =>
      r.type === type &&
      r.id !== except &&
      !HIDDEN_STATUSES.has(r.status) &&
      !RETIRED_STATUSES.has(r.status) &&
      (jaccard(t, new Set(tokenize(r.title))) >= 0.7 ||
        jaccard(ts, new Set(tokenize(`${r.title} ${r.summary}`))) >= 0.5),
  );
}

async function loadText(deps: WriteDeps, nb: Notebook, rec: IndexedRecord): Promise<RecordText> {
  const r = await readRecordFile(deps.fs, join(nb.root, rec.file));
  if (!r.ok) throw new AimemError("INVALID_RECORD", `${rec.file}: ${r.message}`);
  return r.record;
}

async function finish(deps: WriteDeps, nb: Notebook, changed: string[]): Promise<string[]> {
  const index = await loadIndex(nb, { fs: deps.fs });
  if (await writeIndexMd(deps.fs, nb, index, deps.random)) changed.push(".aimem/INDEX.md");
  return changed;
}

export interface AddInput {
  type: RecordType;
  title: string;
  summary: string;
  body?: string;
  author: string;
  status?: string;
  roles?: string[];
  tags?: string[];
  paths?: string[];
  links?: string[];
  supersedes?: string;
  /** Type-specific fields such as kind, priority, assignee. */
  fields?: Record<string, unknown>;
  /** Skip the duplicate check. */
  force?: boolean;
}

/** `aimem add` (04 §4). Nothing is written unless every check passes. */
export async function addRecord(
  nb: Notebook,
  input: AddInput,
  deps: WriteDeps,
): Promise<WriteResult & { type: RecordType; status: string; trust: string }> {
  if (!AUTHOR_RE.test(input.author))
    throw new AimemError(
      "USAGE",
      `author must look like human:<handle> or agent:<tool>[:<model>] (got '${input.author}')`,
    );
  const now = deps.clock.now();
  const warnings: string[] = [];
  const title = input.title.trim();
  const summary = input.summary.trim();
  const body = (input.body ?? "").trim();
  if (!title || title.length > 120)
    throw new AimemError("INVALID_RECORD", "title is required and must be at most 120 characters");
  if (!summary || summary.length > 200 || summary.includes("\n"))
    throw new AimemError("INVALID_RECORD", "summary is required: one line, at most 200 characters");
  if (!body) {
    throw new AimemError(
      "INVALID_RECORD",
      "a body is required; fill in the template and pass it with --body, --body - or --body-file",
      {
        template: bodyTemplate(input.type),
      },
    );
  }
  const status = input.status ?? DEFAULT_STATUS[input.type];
  if (!(STATUSES[input.type] as readonly string[]).includes(status)) {
    throw new AimemError(
      "INVALID_RECORD",
      `status '${status}' not allowed for ${input.type} (allowed: ${STATUSES[input.type].join(", ")})`,
    );
  }

  const index = await loadIndex(nb, { fs: deps.fs });
  checkLinks(nb, index, input.links ?? []);
  let old: IndexedRecord | undefined;
  if (input.supersedes) {
    old = find(nb, index, input.supersedes);
    if (old.type !== input.type)
      throw new AimemError("INVALID_RECORD", `a ${input.type} cannot supersede a ${old.type}`);
    if (!(STATUSES[old.type] as readonly string[]).includes("superseded"))
      throw new AimemError("INVALID_RECORD", `${old.type} records cannot be superseded`);
  }

  const trust = input.author.startsWith("human:") ? "verified" : "agent";
  const id = newUniqueId(input.type, deps.random, new Set(index.records.map((r) => r.id)));
  const fields: Record<string, unknown> = {
    aimem: 1,
    id,
    type: input.type,
    title,
    summary,
    status,
    trust,
    roles: input.roles?.length ? input.roles : ["all"],
    ...(input.tags?.length ? { tags: input.tags } : {}),
    ...(nb.config.repo ? { repo: nb.config.repo } : {}),
    ...(input.paths?.length ? { paths: input.paths } : {}),
    author: input.author,
    created: iso(now),
    updated: iso(now),
    ...(trust === "verified" ? { verified: day(now) } : {}),
    ...(input.links?.length ? { links: input.links } : {}),
    ...(old ? { supersedes: old.id } : {}),
    ...input.fields,
  };
  checkSchema(fields);
  const rec = createRecord(fields, body);
  checkSecrets(serializeRecord(rec));
  if (!input.force && input.type !== "handoff") {
    const dup = findLikelyDuplicate(index, input.type, title, summary, old?.id);
    if (dup) {
      throw new AimemError(
        "DUPLICATE_LIKELY",
        `a similar ${dup.type} exists: ${dup.id} "${dup.title}". Update or supersede it, or pass --force.`,
        {
          ref: dup.id,
          title: dup.title,
          file: dup.file,
        },
      );
    }
  }
  const unknownRoles = (fields.roles as string[]).filter((r) => r !== "all" && !nb.config.roles.includes(r));
  if (unknownRoles.length) warnings.push(`unknown roles: ${unknownRoles.join(", ")} (V014)`);
  if (/\bTODO\b/.test(body)) warnings.push("body still contains TODO markers");
  if (summary.toLowerCase() === title.toLowerCase()) warnings.push("summary equals the title (V009)");

  const file = `.aimem/${TYPE_DIR[input.type]}/${recordFileName({ id, type: input.type, title, created: iso(now) })}`;
  await writeFileAtomic(deps.fs, join(nb.root, file), serializeRecord(rec), deps.random);
  const changed = [file];
  if (old) {
    const oldText = await loadText(deps, nb, old);
    setField(oldText, "status", "superseded");
    setField(oldText, "superseded_by", id);
    setField(oldText, "updated", iso(now));
    await writeRecordFile(deps.fs, join(nb.root, old.file), oldText, deps.random);
    changed.push(old.file);
  }
  return {
    ref: id,
    type: input.type,
    status,
    trust,
    file,
    changed: await finish(deps, nb, changed),
    warnings,
  };
}

/** Fields only tools may set (03 §2.1): use supersede/verify, or never. */
const PROTECTED = new Set([
  "aimem",
  "id",
  "type",
  "created",
  "updated",
  "trust",
  "verified",
  "supersedes",
  "superseded_by",
  "managed_by",
  "source",
  "author",
]);
/** Fields whose `--set` value is a comma-separated list. */
const LIST_FIELDS = new Set([
  "roles",
  "tags",
  "paths",
  "links",
  "blocked_by",
  "decided_by",
  "services",
  "objects",
  "covers",
  "evidence",
]);
const REF_FIELDS = new Set(["links", "blocked_by", "covers"]);

export interface UpdateInput {
  /** key → value; an empty value removes the key. */
  set?: Record<string, string>;
  body?: string;
  /** Allow editing a handoff body. */
  force?: boolean;
  author: string;
}

/** `aimem update` (04 §4). Only edited lines change; unknown keys and comments survive. */
export async function updateRecord(
  nb: Notebook,
  ref: string,
  input: UpdateInput,
  deps: WriteDeps,
): Promise<WriteResult> {
  const set = input.set ?? {};
  if (!Object.keys(set).length && input.body === undefined)
    throw new AimemError("USAGE", "nothing to update: pass --set key=value and/or a body");
  const index = await loadIndex(nb, { fs: deps.fs });
  const rec = find(nb, index, ref);
  if (rec.fm.managed_by === "external")
    throw new AimemError(
      "READONLY_EXTERNAL",
      `${rec.id} is owned by an external source; edit it there or run aimem detach`,
    );
  if (input.body !== undefined && rec.type === "handoff" && !input.force)
    throw new AimemError("PERMISSION_DENIED", "handoff bodies are immutable; pass --force to override");
  const text = await loadText(deps, nb, rec);
  for (const [key, raw] of Object.entries(set)) {
    if (PROTECTED.has(key))
      throw new AimemError(
        "INVALID_RECORD",
        `field '${key}' cannot be set directly (use aimem supersede or aimem verify)`,
      );
    if (raw.trim() === "") {
      deleteField(text, key);
      continue;
    }
    const value = LIST_FIELDS.has(key)
      ? raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : raw;
    if (REF_FIELDS.has(key)) checkLinks(nb, index, value as string[]);
    setField(text, key, value);
  }
  if (input.body !== undefined) {
    if (!input.body.trim()) throw new AimemError("INVALID_RECORD", "the body cannot be empty");
    setBody(text, input.body);
  }
  setField(text, "updated", iso(deps.clock.now()));
  checkSchema(text.data);
  checkSecrets(serializeRecord(text));
  await writeRecordFile(deps.fs, join(nb.root, rec.file), text, deps.random);
  return { ref: rec.id, file: rec.file, changed: await finish(deps, nb, [rec.file]), warnings: [] };
}

/** `aimem supersede <old> --by <new>`: link both, mark the old one superseded. */
export async function supersedeRecord(
  nb: Notebook,
  oldRef: string,
  newRef: string,
  deps: WriteDeps,
): Promise<WriteResult & { old: string }> {
  const index = await loadIndex(nb, { fs: deps.fs });
  const old = find(nb, index, oldRef);
  const next = find(nb, index, newRef);
  if (old.id === next.id) throw new AimemError("INVALID_RECORD", "a record cannot supersede itself");
  if (old.type !== next.type)
    throw new AimemError("INVALID_RECORD", `a ${next.type} cannot supersede a ${old.type}`);
  if (!(STATUSES[old.type] as readonly string[]).includes("superseded"))
    throw new AimemError("INVALID_RECORD", `${old.type} records cannot be superseded`);
  const now = iso(deps.clock.now());
  const oldText = await loadText(deps, nb, old);
  const nextText = await loadText(deps, nb, next);
  setField(oldText, "status", "superseded");
  setField(oldText, "superseded_by", next.id);
  setField(oldText, "updated", now);
  setField(nextText, "supersedes", old.id);
  setField(nextText, "updated", now);
  await writeRecordFile(deps.fs, join(nb.root, old.file), oldText, deps.random);
  await writeRecordFile(deps.fs, join(nb.root, next.file), nextText, deps.random);
  return {
    ref: next.id,
    old: old.id,
    file: next.file,
    changed: await finish(deps, nb, [old.file, next.file]),
    warnings: [],
  };
}

/** `aimem verify`: humans only (03 §5). */
export async function verifyRecords(
  nb: Notebook,
  refs: string[],
  author: string,
  deps: WriteDeps,
): Promise<{ refs: string[]; changed: string[] }> {
  if (!AUTHOR_RE.test(author)) throw new AimemError("USAGE", `invalid author '${author}'`);
  if (!author.startsWith("human:"))
    throw new AimemError("PERMISSION_DENIED", "only a human author can verify records");
  if (!refs.length) throw new AimemError("USAGE", "give at least one record to verify");
  const index = await loadIndex(nb, { fs: deps.fs });
  const recs = refs.map((r) => find(nb, index, r));
  const now = deps.clock.now();
  const changed: string[] = [];
  for (const rec of recs) {
    const text = await loadText(deps, nb, rec);
    setField(text, "trust", "verified");
    setField(text, "verified", day(now));
    setField(text, "updated", iso(now));
    await writeRecordFile(deps.fs, join(nb.root, rec.file), text, deps.random);
    changed.push(rec.file);
  }
  return { refs: recs.map((r) => r.id), changed: await finish(deps, nb, changed) };
}
