import fs from "node:fs";
import {
  BODY_SECTIONS, DEFAULT_STATUS, INACTIVE_STATUSES, STATUSES, frontmatterSchema, newId, typeFromId,
  type RecordType, type Trust,
} from "@aimem/schema";
import { AimemError } from "./errors.js";
import { writeIndex } from "./index-md.js";
import { jaccard, tokens } from "./search.js";
import { scanSecrets } from "./secrets.js";
import { findRecord, loadRecords, writeRecord, type FM, type Notebook, type Rec } from "./store.js";

const iso = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;
const day = (d: Date) => d.toISOString().slice(0, 10);

export function authorTrust(author: string): Trust {
  return author.startsWith("agent:") ? "agent" : "verified";
}
export function assertAuthor(author: string): void {
  if (!/^(human|agent):[^\s:]+(:[^\s]+)?$/.test(author)) {
    throw new AimemError("USAGE", `author must look like human:<handle> or agent:<tool>[:<model>] (got '${author}')`);
  }
}

export function bodyTemplate(type: RecordType): string {
  const s = BODY_SECTIONS[type];
  return s.length ? s.map((h) => `## ${h}\nTODO`).join("\n\n") : "TODO: state the fact, why we know it, and how to verify it.";
}

export interface AddInput {
  type: RecordType; title: string; summary: string; body?: string; author: string;
  status?: string; roles?: string[]; tags?: string[]; paths?: string[]; links?: string[]; supersedes?: string;
  extra?: Record<string, unknown>; force?: boolean; now?: Date;
}
export interface OpResult { rec: Rec; file: string; warnings: string[] }

function reindex(nb: Notebook): void { writeIndex(nb, loadRecords(nb).records); }

function touch(nb: Notebook, rec: Rec, now: Date): string {
  rec.fm.updated = iso(now);
  const parsed = frontmatterSchema.safeParse(rec.fm);
  if (!parsed.success) throw new AimemError("INVALID_RECORD", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return writeRecord(nb, { fm: rec.fm, body: rec.body, file: rec.file });
}

export function addRecord(nb: Notebook, input: AddInput): OpResult {
  const now = input.now ?? new Date();
  const warnings: string[] = [];
  assertAuthor(input.author);
  const title = input.title.trim(), summary = input.summary.trim();
  if (!title || title.length > 120) throw new AimemError("INVALID_RECORD", "title is required and must be ≤ 120 characters");
  if (!summary || summary.length > 200 || /\n/.test(summary)) throw new AimemError("INVALID_RECORD", "summary is required: one line, ≤ 200 characters");
  const body = (input.body ?? "").trim();
  if (!body) throw new AimemError("INVALID_RECORD", "body is required", { template: bodyTemplate(input.type) });
  if (/^TODO\b/m.test(body)) warnings.push("body still contains TODO markers");
  const secrets = scanSecrets(`${title}\n${summary}\n${body}`);
  if (secrets.length) throw new AimemError("SECRET_DETECTED", `possible secret detected (${secrets.join(", ")}); remove it and retry`, { kinds: secrets });

  const status = input.status ?? DEFAULT_STATUS[input.type];
  if (!STATUSES[input.type].includes(status)) throw new AimemError("INVALID_RECORD", `status '${status}' not allowed for ${input.type} (allowed: ${STATUSES[input.type].join(", ")})`);

  const { records } = loadRecords(nb);

  if (!input.force && input.type !== "handoff") {
    const mine = tokens(`${title} ${summary}`);
    const dup = records.find((r) => r.fm.type === input.type && !INACTIVE_STATUSES.has(r.fm.status)
      && r.fm.id !== input.supersedes && jaccard(mine, tokens(`${r.fm.title} ${r.fm.summary}`)) >= 0.6);
    if (dup) throw new AimemError("DUPLICATE_LIKELY", `a similar ${input.type} exists: ${dup.fm.id} "${dup.fm.title}". Update or supersede it, or pass --force.`, { ref: dup.fm.id, title: dup.fm.title });
  }
  for (const l of input.links ?? []) {
    if (!l.includes(":") && !findRecord(records, l)) throw new AimemError("INVALID_RECORD", `link target ${l} not found`);
  }
  let old: Rec | undefined;
  if (input.supersedes) {
    old = findRecord(records, input.supersedes);
    if (!old) throw new AimemError("NOT_FOUND", `cannot supersede ${input.supersedes}: not found`);
    if (old.fm.type !== input.type) throw new AimemError("INVALID_RECORD", "a record can only supersede one of the same type");
    if (!STATUSES[old.fm.type].includes("superseded")) throw new AimemError("INVALID_RECORD", `${old.fm.type} records cannot be superseded`);
  }

  const ids = new Set(records.map((r) => r.fm.id));
  let id = newId(input.type);
  while (ids.has(id)) id = newId(input.type);
  const trust = authorTrust(input.author);
  const fm = {
    aimem: 1, id, type: input.type, title, summary, status, trust,
    roles: input.roles?.length ? input.roles : ["all"],
    ...(input.tags?.length ? { tags: input.tags } : {}),
    ...(nb.config.repo ? { repo: nb.config.repo } : {}),
    ...(input.paths?.length ? { paths: input.paths } : {}),
    author: input.author, created: iso(now), updated: iso(now),
    ...(trust === "verified" ? { verified: day(now) } : {}),
    ...(input.links?.length ? { links: input.links } : {}),
    ...(input.supersedes ? { supersedes: input.supersedes } : {}),
    ...(input.extra ?? {}),
  } as FM;
  const file = writeRecord(nb, { fm, body });
  if (old) {
    old.fm.status = "superseded";
    old.fm.superseded_by = id;
    touch(nb, old, now);
  }
  reindex(nb);
  return { rec: { fm, body, file, dirType: input.type }, file, warnings };
}

const LIST_KEYS = new Set(["tags", "roles", "paths", "links", "blocked_by", "decided_by", "services", "objects", "covers"]);
const PROTECTED = new Set(["id", "type", "created", "trust", "aimem", "updated", "superseded_by", "supersedes", "managed_by", "source"]);

export interface UpdateInput { set?: Record<string, string>; body?: string; force?: boolean; author: string; now?: Date }

export function updateRecord(nb: Notebook, ref: string, input: UpdateInput): OpResult {
  const now = input.now ?? new Date();
  const { records } = loadRecords(nb);
  const rec = findRecord(records, ref, nb.config.project);
  if (!rec) throw new AimemError("NOT_FOUND", `record ${ref} not found`);
  if (rec.fm.managed_by === "external") throw new AimemError("READONLY_EXTERNAL", `${ref} is owned by an external source; edit it there`);
  if (input.body !== undefined && rec.fm.type === "handoff" && !input.force) throw new AimemError("PERMISSION_DENIED", "handoff bodies are immutable; pass --force to override");
  for (const [k, v] of Object.entries(input.set ?? {})) {
    if (PROTECTED.has(k)) throw new AimemError("INVALID_RECORD", `field '${k}' cannot be set directly`);
    (rec.fm as Record<string, unknown>)[k] = LIST_KEYS.has(k) ? v.split(",").map((s) => s.trim()).filter(Boolean) : v;
  }
  if (!STATUSES[rec.fm.type].includes(rec.fm.status)) throw new AimemError("INVALID_RECORD", `status '${rec.fm.status}' not allowed for ${rec.fm.type} (allowed: ${STATUSES[rec.fm.type].join(", ")})`);
  if (input.body !== undefined) rec.body = input.body.trim();
  const secrets = scanSecrets(`${rec.fm.title}\n${rec.fm.summary}\n${rec.body}`);
  if (secrets.length) throw new AimemError("SECRET_DETECTED", `possible secret detected (${secrets.join(", ")})`, { kinds: secrets });
  const file = touch(nb, rec, now);
  reindex(nb);
  return { rec, file, warnings: [] };
}

export function supersedeRecord(nb: Notebook, oldRef: string, newRef: string, now = new Date()): { old: Rec; next: Rec } {
  const { records } = loadRecords(nb);
  const old = findRecord(records, oldRef, nb.config.project);
  const next = findRecord(records, newRef, nb.config.project);
  if (!old) throw new AimemError("NOT_FOUND", `record ${oldRef} not found`);
  if (!next) throw new AimemError("NOT_FOUND", `record ${newRef} not found`);
  if (old.fm.id === next.fm.id) throw new AimemError("INVALID_RECORD", "a record cannot supersede itself");
  if (old.fm.type !== next.fm.type) throw new AimemError("INVALID_RECORD", "records must have the same type");
  if (!STATUSES[old.fm.type].includes("superseded")) throw new AimemError("INVALID_RECORD", `${old.fm.type} records cannot be superseded`);
  old.fm.status = "superseded"; old.fm.superseded_by = next.fm.id;
  next.fm.supersedes = old.fm.id;
  touch(nb, old, now); touch(nb, next, now);
  reindex(nb);
  return { old, next };
}

export function verifyRecords(nb: Notebook, refs: string[], author: string, now = new Date()): Rec[] {
  assertAuthor(author);
  if (!author.startsWith("human:")) throw new AimemError("PERMISSION_DENIED", "only a human author can verify records");
  const { records } = loadRecords(nb);
  const out: Rec[] = [];
  for (const ref of refs) {
    const rec = findRecord(records, ref, nb.config.project);
    if (!rec) throw new AimemError("NOT_FOUND", `record ${ref} not found`);
    rec.fm.trust = "verified"; rec.fm.verified = day(now);
    touch(nb, rec, now); out.push(rec);
  }
  reindex(nb);
  return out;
}

export function linkRecords(nb: Notebook, a: string, b: string, now = new Date()): void {
  const { records } = loadRecords(nb);
  const ra = findRecord(records, a, nb.config.project), rb = findRecord(records, b, nb.config.project);
  if (!ra) throw new AimemError("NOT_FOUND", `record ${a} not found`);
  if (!rb) throw new AimemError("NOT_FOUND", `record ${b} not found`);
  for (const [x, y] of [[ra, rb], [rb, ra]] as const) {
    const links = new Set(x.fm.links ?? []); links.add(y.fm.id); x.fm.links = [...links].sort();
    touch(nb, x, now);
  }
  reindex(nb);
}

export function discardRecord(nb: Notebook, ref: string): void {
  const { records } = loadRecords(nb);
  const rec = findRecord(records, ref, nb.config.project);
  if (!rec) throw new AimemError("NOT_FOUND", `record ${ref} not found`);
  if (rec.fm.trust === "verified" || rec.fm.verified) throw new AimemError("PERMISSION_DENIED", "verified records are superseded, never deleted (ADR-007)");
  const linked = records.find((r) => r.fm.id !== rec.fm.id && ((r.fm.links ?? []).includes(rec.fm.id) || r.fm.supersedes === rec.fm.id || r.fm.superseded_by === rec.fm.id));
  if (linked) throw new AimemError("PERMISSION_DENIED", `${linked.fm.id} links to this record; it cannot be discarded`);
  fs.unlinkSync(rec.file);
  reindex(nb);
}

export interface HandoffInput {
  done: string; notDone: string; next: string; blocked?: string; notes?: string;
  task?: string; session?: string; branch?: string; author: string; now?: Date; roles?: string[];
}
export function addHandoff(nb: Notebook, i: HandoffInput): OpResult {
  const now = i.now ?? new Date();
  const first = (s: string) => s.replace(/^[-*\s]+/, "").split("\n")[0]!.trim();
  const summary = `Done: ${first(i.done)} · Next: ${first(i.next)}`.slice(0, 200);
  const body = [["Done", i.done], ["Not done", i.notDone], ["Next", i.next], ["Blocked", i.blocked || "none"], ["Notes for next agent", i.notes || "none"]]
    .map(([h, t]) => `## ${h}\n${(t ?? "").trim() || "none"}`).join("\n\n");
  return addRecord(nb, {
    type: "handoff", title: `Handoff ${day(now)}: ${first(i.done).slice(0, 80)}`, summary, body, author: i.author, now,
    roles: i.roles, force: true,
    extra: { ...(i.task ? { task: i.task } : {}), ...(i.session ? { session: i.session } : {}), ...(i.branch ? { branch: i.branch } : {}) },
  });
}
export { typeFromId };
