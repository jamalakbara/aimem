import { join } from "node:path";
import {
  BODY_SECTIONS,
  DEFAULT_STATUS,
  type RecordType,
  recordSchema,
  STATUSES,
  TYPE_DIR,
} from "@aimem/schema";
import { refreshVectorsAfterWrite } from "../embed/cache.js";
import type { EmbeddingProvider } from "../embed/provider.js";
import { AimemError } from "../errors.js";
import { type IndexedRecord, loadIndex, type NotebookIndex } from "../index/build.js";
import type { Clock, Fs, Random } from "../ports.js";
import type { Notebook } from "../project/load.js";
import { isMultiRepo, loadProjectIndex, type ProjectIndex } from "../project/sources.js";
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
import { duplicateFinder } from "../review/queue.js";
import { tokenize } from "../search/bm25.js";
import { HIDDEN_STATUSES } from "../search/search.js";
import { scanSecrets } from "../secrets/scan.js";
import { contentSha, RETIRED_STATUSES } from "../validate/validate.js";
import { requiresReview } from "./policy.js";

export interface WriteDeps {
  fs: Fs;
  clock: Clock;
  random: Random;
  /** When set, new or changed chunks are embedded after the write (15 §13). */
  embedder?: EmbeddingProvider;
  /** Where cached sibling checkouts live (03 §7); used for cross-notebook checks. */
  cacheHome?: string;
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

/**
 * Link targets must exist. In a multi-repo project a project-qualified ref may name a record in the
 * hub or a sibling (03 §7); it is accepted when found there, or when a source could not be read.
 */
async function checkLinks(nb: Notebook, index: NotebookIndex, refs: string[], fs: Fs): Promise<void> {
  let project: ProjectIndex | undefined;
  for (const ref of refs) {
    const id = localId(ref, nb.config.project);
    if (id === undefined || index.records.some((r) => r.id === id)) continue;
    if (ref.includes(":") && isMultiRepo(nb)) {
      project ??= await loadProjectIndex(nb, { fs });
      if (project.records.some((r) => r.id === id)) continue;
      if (project.sources.some((s) => s.status !== "ok")) continue;
    }
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

/** After every write: re-render INDEX.md, then refresh the vector cache (never fails the write). */
async function finish(
  deps: WriteDeps,
  nb: Notebook,
  changed: string[],
): Promise<{ changed: string[]; warnings: string[] }> {
  const index = await loadIndex(nb, { fs: deps.fs });
  if (await writeIndexMd(deps.fs, nb, index, deps.random)) changed.push(".aimem/INDEX.md");
  const warnings: string[] = [];
  if (deps.embedder) {
    const r = await refreshVectorsAfterWrite(nb, index, deps.embedder, deps);
    if (r.warning) warnings.push(r.warning);
  }
  return { changed, warnings };
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
  /** `aimem adopt` drafts (08 §2.1 Phase C): `trust: inferred` whoever the author is. */
  inferred?: boolean;
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
  await checkLinks(nb, index, input.links ?? [], deps.fs);
  let old: IndexedRecord | undefined;
  if (input.supersedes) {
    old = find(nb, index, input.supersedes);
    refuseExternal(old, "supersede");
    if (old.type !== input.type)
      throw new AimemError("INVALID_RECORD", `a ${input.type} cannot supersede a ${old.type}`);
    if (!(STATUSES[old.type] as readonly string[]).includes("superseded"))
      throw new AimemError("INVALID_RECORD", `${old.type} records cannot be superseded`);
  }

  // 03 §6 durable_requires_review: in team mode a human's decision/runbook/schema waits for a second
  // person's `aimem verify`, so it starts unreviewed like an agent record.
  const review = requiresReview(nb.config, input.type);
  const trust = input.inferred
    ? "inferred"
    : input.author.startsWith("human:") && !review
      ? "verified"
      : "agent";
  // 03 §7 rule 6: IDs are unique per project, so other notebooks' IDs are taken too.
  const project = isMultiRepo(nb)
    ? await loadProjectIndex(nb, { fs: deps.fs, ...(deps.cacheHome ? { cacheHome: deps.cacheHome } : {}) })
    : undefined;
  const id = newUniqueId(
    input.type,
    deps.random,
    new Set([...index.records, ...(project?.records ?? [])].map((r) => r.id)),
  );
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
    // Team duplicate check (M3.7c): this notebook first, then the hub and sibling notebooks.
    const dup =
      findLikelyDuplicate(index, input.type, title, summary, old?.id) ??
      (project
        ? findLikelyDuplicate(
            { records: project.records.filter((r) => r.notebook), problems: [] },
            input.type,
            title,
            summary,
            old?.id,
          )
        : undefined);
    if (dup) {
      const where = dup.notebook ? ` in ${dup.notebook}` : "";
      const ref = dup.notebook ? `${nb.config.project}:${dup.id}` : dup.id;
      throw new AimemError(
        "DUPLICATE_LIKELY",
        `a similar ${dup.type} exists${where}: ${dup.id} "${dup.title}". Open it with aimem show ${ref}, then update or supersede it${dup.notebook ? " there" : ""}, or pass --force to add this one anyway.`,
        {
          ref: dup.id,
          title: dup.title,
          file: dup.file,
          ...(dup.notebook ? { notebook: dup.notebook } : {}),
        },
      );
    }
  }
  const unknownRoles = (fields.roles as string[]).filter((r) => r !== "all" && !nb.config.roles.includes(r));
  if (unknownRoles.length) warnings.push(`unknown roles: ${unknownRoles.join(", ")} (V014)`);
  if (review && input.author.startsWith("human:") && !input.inferred)
    warnings.push(
      `Awaiting verification by another teammate: ${input.type} records need a second person's review here; ask them to run aimem verify ${id}`,
    );
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
  const done = await finish(deps, nb, changed);
  return {
    ref: id,
    type: input.type,
    status,
    trust,
    file,
    changed: done.changed,
    warnings: [...warnings, ...done.warnings],
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
    if (REF_FIELDS.has(key)) await checkLinks(nb, index, value as string[], deps.fs);
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
  return { ref: rec.id, file: rec.file, ...(await finish(deps, nb, [rec.file])) };
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
  refuseExternal(old, "supersede");
  refuseExternal(next, "supersede");
  if (old.type !== next.type)
    throw new AimemError("INVALID_RECORD", `a ${next.type} cannot supersede a ${old.type}`);
  if (!(STATUSES[old.type] as readonly string[]).includes("superseded"))
    throw new AimemError("INVALID_RECORD", `${old.type} records cannot be superseded`);
  // 08 §2.2 rule 2: an unreviewed adopted draft cannot be the basis of an accepted decision.
  if (next.type === "decision" && next.trust === "inferred" && next.status === "accepted")
    throw new AimemError(
      "USAGE",
      `${next.id} is inferred (adopted, not reviewed); verify it before it supersedes an accepted decision`,
    );
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
    ...(await finish(deps, nb, [old.file, next.file])),
  };
}

/** `aimem verify`: humans only (03 §5). */
export async function verifyRecords(
  nb: Notebook,
  refs: string[],
  author: string,
  deps: WriteDeps,
): Promise<{ refs: string[]; changed: string[]; warnings: string[] }> {
  if (!AUTHOR_RE.test(author)) throw new AimemError("USAGE", `invalid author '${author}'`);
  if (!author.startsWith("human:"))
    throw new AimemError(
      "PERMISSION_DENIED",
      `only a human can verify records; ask a person on the team to run aimem verify ${refs.length ? refs.join(" ") : "<ref>"}`,
    );
  if (!refs.length) throw new AimemError("USAGE", "give at least one record to verify");
  const index = await loadIndex(nb, { fs: deps.fs });
  const recs = refs.map((r) => find(nb, index, r));
  for (const rec of recs) {
    if (requiresReview(nb.config, rec.type) && rec.author === author)
      throw new AimemError(
        "PERMISSION_DENIED",
        `${rec.id} needs review by someone other than its author (write_policy.durable_requires_review); ask a teammate to run aimem verify ${rec.id}`,
      );
  }
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
  return { refs: recs.map((r) => r.id), ...(await finish(deps, nb, changed)) };
}

/**
 * `aimem discard` (04, 08 §2.1 Phase D): delete a record that was never verified and that no record
 * links to — the one exception to "never delete" (ADR-007). Humans only.
 */
export async function discardRecord(
  nb: Notebook,
  ref: string,
  author: string,
  deps: WriteDeps,
): Promise<{ ref: string; file: string; changed: string[]; warnings: string[] }> {
  if (!AUTHOR_RE.test(author)) throw new AimemError("USAGE", `invalid author '${author}'`);
  if (!author.startsWith("human:"))
    throw new AimemError(
      "PERMISSION_DENIED",
      `only a human can discard records; ask a person on the team to run aimem discard ${ref}`,
    );
  const index = await loadIndex(nb, { fs: deps.fs });
  const rec = find(nb, index, ref);
  if (rec.fm.managed_by === "external")
    throw new AimemError(
      "READONLY_EXTERNAL",
      `${rec.id} is owned by an external source; remove it there, or aimem detach it first`,
    );
  if (rec.fm.moved_to !== undefined)
    throw new AimemError(
      "INVALID_RECORD",
      `${rec.id} is a pointer to a moved record; discard it where it lives now`,
    );
  if (rec.trust === "verified" || rec.fm.verified !== undefined)
    throw new AimemError(
      "PERMISSION_DENIED",
      `${rec.id} was verified; only never-verified records can be discarded (supersede it instead)`,
    );
  const linker = index.records.find(
    (r) =>
      r.id !== rec.id &&
      (r.links.some((l) => l === rec.id || l.endsWith(`:${rec.id}`)) ||
        r.fm.supersedes === rec.id ||
        r.fm.superseded_by === rec.id),
  );
  if (linker)
    throw new AimemError(
      "INVALID_RECORD",
      `${rec.id} is linked from ${linker.id}; supersede it instead of discarding it`,
    );
  // 03 §7: hub and sibling notebooks may link to this record with a project-qualified ref.
  if (isMultiRepo(nb)) {
    const project = await loadProjectIndex(nb, {
      fs: deps.fs,
      ...(deps.cacheHome ? { cacheHome: deps.cacheHome } : {}),
    });
    const global = `${nb.config.project}:${rec.id}`;
    const far = project.records.find(
      (r) =>
        r.notebook &&
        (r.links.includes(global) || r.fm.supersedes === global || r.fm.superseded_by === global),
    );
    if (far)
      throw new AimemError(
        "INVALID_RECORD",
        `${rec.id} is linked from ${far.id} in ${far.notebook}; supersede it instead of discarding it`,
      );
  }
  const changed = [rec.file];
  // A discarded adopted draft must not come back on the next \`aimem adopt\` (QA, M4.5 plan item 7).
  const evidence = Array.isArray(rec.fm.evidence) ? rec.fm.evidence.map(String) : [];
  if (evidence.length) {
    const path = join(nb.dir, ADOPT_DISCARDED_FILE);
    const old = await deps.fs.readFile(path).catch(() => "");
    const head = old ? "" : ADOPT_DISCARDED_HEADER;
    await writeFileAtomic(deps.fs, path, `${old}${head}${discardedKey(evidence)}\n`, deps.random);
    changed.push(`.aimem/${ADOPT_DISCARDED_FILE}`);
  }
  await deps.fs.unlink(join(nb.root, rec.file));
  const done = await finish(deps, nb, changed);
  return {
    ref: rec.id,
    file: rec.file,
    changed: [rec.file, ...done.changed.filter((f) => f !== rec.file)],
    warnings: done.warnings,
  };
}

/** Evidence of adopted drafts a person discarded; \`aimem adopt\` skips them (tracked, like secretignore). */
export const ADOPT_DISCARDED_FILE = "adopt-discarded";
const ADOPT_DISCARDED_HEADER =
  "# Evidence of adopted drafts that were discarded. aimem adopt skips these; delete a line to adopt it again.\n";
/** One line per discarded draft: its evidence, sorted, comma-separated. */
export const discardedKey = (evidence: readonly string[]) => [...evidence].sort().join(", ");

/** Keys from \`.aimem/adopt-discarded\` (\`#\` starts a comment). */
export async function loadDiscarded(fs: Fs, aimemDir: string): Promise<Set<string>> {
  const text = await fs.readFile(join(aimemDir, ADOPT_DISCARDED_FILE)).catch(() => "");
  return new Set(
    text
      .split("\n")
      .map((l) => l.replace(/#.*/, "").trim())
      .filter(Boolean),
  );
}

/** 16 §2 rule 2: an externally-owned record is edited at its source, never here. */
function refuseExternal(rec: IndexedRecord, verb: string): void {
  if (rec.fm.managed_by !== "external") return;
  const system = (rec.fm.source as { system?: string } | undefined)?.system ?? "an external source";
  throw new AimemError(
    "READONLY_EXTERNAL",
    `${rec.id} is owned by ${system}; edit it at the source, or run aimem detach ${rec.id} before you ${verb} it here`,
  );
}

type ExternalSystem = "upload" | "google-doc" | "google-sheet";

export interface ExternalInput {
  type: RecordType;
  title: string;
  summary: string;
  body: string;
  author: string;
  status?: string;
  roles?: string[];
  tags?: string[];
  fields?: Record<string, unknown>;
  /** Create even when a likely duplicate exists (e.g. a detached copy). */
  force?: boolean;
  source: {
    system: ExternalSystem;
    id: string;
    url: string;
    row?: number | string;
    version: string | number;
  };
}

export interface ExternalResult {
  action: "created" | "updated" | "unchanged";
  ref: string;
  file: string;
  trust: string;
  changed: string[];
  warnings: string[];
}

/**
 * 16 §2.1 idempotency: find the record owned by \`(system, id[, row])\` and create it, rewrite it, or
 * leave it alone when nothing changed. Never touches a notebook-owned record. Trust follows \`add\`:
 * a human import is verified unless \`durable_requires_review\` applies; an agent import is \`agent\`.
 */
export async function upsertExternal(
  nb: Notebook,
  input: ExternalInput,
  deps: WriteDeps,
): Promise<ExternalResult> {
  const r = await upsertExternalMany(nb, [input], deps);
  const one = r.results[0];
  if (!one) throw new AimemError("USAGE", "nothing to import");
  if ("error" in one) throw one.error;
  return { ...one, changed: r.changed, warnings: [...one.warnings, ...r.warnings] };
}

export type ExternalItemResult =
  | (Omit<ExternalResult, "changed"> & { previousTitle?: string })
  | { error: AimemError };

/**
 * Many imports in one pass (a sheet, a sync run): the index is loaded once, duplicates are checked
 * through one token index, and INDEX.md and the vector cache are refreshed once at the end (QA, #100:
 * one loadIndex per row made a 400-row sheet take 143 s). Each item fails on its own.
 */
export async function upsertExternalMany(
  nb: Notebook,
  inputs: readonly ExternalInput[],
  deps: WriteDeps,
): Promise<{ results: ExternalItemResult[]; changed: string[]; warnings: string[] }> {
  const index = await loadIndex(nb, { fs: deps.fs });
  const now = deps.clock.now();
  const keyOf = (system: string, id: string, row: unknown) =>
    `${system}\u0000${id}\u0000${row === undefined ? "" : String(row)}`;
  const owned = new Map<string, IndexedRecord>();
  for (const r of index.records) {
    const s = r.fm.source as { system?: string; id?: unknown; row?: unknown } | undefined;
    if (!r.notebook && r.fm.managed_by === "external" && s?.system)
      owned.set(keyOf(s.system, String(s.id), s.row), r);
  }
  // Records of the sources being imported are told apart by their keys, so the duplicate check looks
  // only at the rest of the notebook (QA, #99 / 4b.2).
  const sources = new Set(inputs.map((i) => `${i.source.system}\u0000${i.source.id}`));
  const others = index.records.filter((r) => {
    const s = r.fm.source as { system?: string; id?: unknown } | undefined;
    return !(r.fm.managed_by === "external" && s?.system && sources.has(`${s.system}\u0000${String(s.id)}`));
  });
  const findDup = duplicateFinder(others);
  const project = isMultiRepo(nb)
    ? await loadProjectIndex(nb, { fs: deps.fs, ...(deps.cacheHome ? { cacheHome: deps.cacheHome } : {}) })
    : undefined;
  const taken = new Set([...index.records, ...(project?.records ?? [])].map((r) => r.id));
  const changed = new Set<string>();
  const results: ExternalItemResult[] = [];

  for (const input of inputs) {
    try {
      results.push(await upsertOne(input));
    } catch (e) {
      if (!(e instanceof AimemError)) throw e;
      results.push({ error: e });
    }
  }
  const done = await finish(deps, nb, [...changed]);
  return { results, changed: [...new Set(done.changed)].sort(), warnings: done.warnings };

  async function upsertOne(input: ExternalInput): Promise<ExternalItemResult> {
    const src = input.source;
    const body = input.body.trim();
    const sha = contentSha(body);
    const title = input.title.trim();
    const summary = input.summary.trim();
    const sourceFields = (imported_by: string) => ({
      system: src.system,
      id: src.id,
      url: src.url,
      ...(src.row !== undefined ? { row: src.row } : {}),
      version: src.version,
      content_sha: sha,
      synced_at: iso(now),
      imported_by,
      state: "ok",
    });
    const key = keyOf(src.system, src.id, src.row);
    const existing = owned.get(key);

    if (!existing) {
      if (!AUTHOR_RE.test(input.author))
        throw new AimemError(
          "USAGE",
          `author must look like human:<handle> or agent:<tool> (got '${input.author}')`,
        );
      if (!title || title.length > 120)
        throw new AimemError("INVALID_RECORD", "title is required and must be at most 120 characters");
      if (!summary || summary.length > 200 || summary.includes("\n"))
        throw new AimemError("INVALID_RECORD", "summary is required: one line, at most 200 characters");
      if (!body) throw new AimemError("INVALID_RECORD", "the imported body is empty");
      const status = input.status ?? DEFAULT_STATUS[input.type];
      if (!(STATUSES[input.type] as readonly string[]).includes(status))
        throw new AimemError("INVALID_RECORD", `status '${status}' not allowed for ${input.type}`);
      if (!input.force) {
        const dup = findDup(input.type, title, summary);
        if (dup)
          throw new AimemError(
            "DUPLICATE_LIKELY",
            `a similar ${dup.type} exists: ${dup.id} "${dup.title}". Update or supersede it, or pass --force to import this one anyway.`,
            { ref: dup.id, title: dup.title, file: dup.file },
          );
      }
      const trust =
        input.author.startsWith("human:") && !requiresReview(nb.config, input.type) ? "verified" : "agent";
      const id = newUniqueId(input.type, deps.random, taken);
      taken.add(id);
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
        author: input.author,
        created: iso(now),
        updated: iso(now),
        ...(trust === "verified" ? { verified: day(now) } : {}),
        ...input.fields,
        managed_by: "external",
        source: sourceFields(input.author),
      };
      checkSchema(fields);
      const rec = createRecord(fields, body);
      checkSecrets(serializeRecord(rec));
      const file = `.aimem/${TYPE_DIR[input.type]}/${recordFileName({ id, type: input.type, title, created: iso(now) })}`;
      await writeFileAtomic(deps.fs, join(nb.root, file), serializeRecord(rec), deps.random);
      changed.add(file);
      owned.set(key, {
        id,
        type: input.type,
        status,
        trust,
        title,
        summary,
        tags: input.tags ?? [],
        roles: (fields.roles as string[]) ?? ["all"],
        paths: [],
        links: [],
        author: input.author,
        created: iso(now),
        updated: iso(now),
        fm: fields,
        body,
        file,
        text: serializeRecord(rec),
      });
      // Same reminder as add (M3.7): a human's durable record waits for a second teammate (QA, #102).
      const warnings =
        trust === "agent" && input.author.startsWith("human:")
          ? [
              `Awaiting verification by another teammate: ${input.type} records need a second person's review here; ask them to run aimem verify ${id}`,
            ]
          : [];
      return { action: "created", ref: id, file, trust, warnings };
    }

    const old = existing.fm.source as { content_sha?: string; state?: string; imported_by?: string };
    const fieldsSame = Object.entries(input.fields ?? {}).every(
      ([k, v]) => JSON.stringify(existing.fm[k]) === JSON.stringify(v),
    );
    const same =
      old.content_sha === sha &&
      old.state === "ok" &&
      existing.title === title &&
      existing.summary === summary &&
      fieldsSame &&
      (input.status === undefined || existing.status === input.status);
    if (same)
      return {
        action: "unchanged",
        ref: existing.id,
        file: existing.file,
        trust: existing.trust,
        warnings: [],
      };

    const text = await loadText(deps, nb, existing);
    setField(text, "title", title);
    setField(text, "summary", summary);
    if (input.status) setField(text, "status", input.status);
    for (const [k, v] of Object.entries(input.fields ?? {})) setField(text, k, v);
    setField(text, "updated", iso(now));
    setField(text, "source", sourceFields(old.imported_by ?? input.author));
    setBody(text, body);
    checkSchema({ ...text.data });
    checkSecrets(serializeRecord(text));
    // A new title gets a new file name; the ID and history stay.
    const file = `.aimem/${TYPE_DIR[existing.type]}/${recordFileName({ id: existing.id, type: existing.type, title, created: existing.created })}`;
    await writeRecordFile(deps.fs, join(nb.root, file), text, deps.random);
    changed.add(file);
    if (file !== existing.file) {
      await deps.fs.unlink(join(nb.root, existing.file));
      changed.add(existing.file);
    }
    owned.set(key, { ...existing, title, summary, file, body });
    return {
      action: "updated",
      ref: existing.id,
      file,
      trust: existing.trust,
      warnings: [],
      ...(existing.title !== title ? { previousTitle: existing.title } : {}),
    };
  }
}

/**
 * \`aimem detach\` (16 §2 rule 3): make an externally-owned record notebook-owned for good. The source
 * fields go, a line in the body says where it came from, and later imports no longer update it.
 */
export async function detachRecord(
  nb: Notebook,
  ref: string,
  author: string,
  deps: WriteDeps,
): Promise<{ ref: string; file: string; changed: string[]; warnings: string[] }> {
  if (!AUTHOR_RE.test(author)) throw new AimemError("USAGE", `invalid author '${author}'`);
  const index = await loadIndex(nb, { fs: deps.fs });
  const rec = find(nb, index, ref);
  if (rec.fm.managed_by !== "external")
    throw new AimemError("USAGE", `${rec.id} is not owned by an external source; nothing to detach`);
  const src = (rec.fm.source ?? {}) as { system?: string; id?: unknown; version?: unknown };
  const now = deps.clock.now();
  const text = await loadText(deps, nb, rec);
  deleteField(text, "managed_by");
  deleteField(text, "source");
  setField(text, "updated", iso(now));
  setBody(
    text,
    `${rec.body.trim()}\n\n---\n\n_Detached from ${src.system ?? "an external source"} ${String(src.id ?? "")} (version ${String(src.version ?? "?")}) on ${day(now)} by ${author}._`,
  );
  await writeRecordFile(deps.fs, join(nb.root, rec.file), text, deps.random);
  return { ref: rec.id, file: rec.file, ...(await finish(deps, nb, [rec.file])) };
}
