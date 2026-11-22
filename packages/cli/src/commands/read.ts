import {
  AimemError,
  freshnessOf,
  type IndexedRecord,
  loadProject,
  RETIRED_STATUSES,
  searchWithRewrites,
} from "@aimem/core";
import { RECORD_TYPES } from "@aimem/schema";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";
import { table } from "../output.js";
import { retrievalDeps } from "./retrieval.js";
import { retrievalMode, semanticFor } from "./semantic.js";
import { notebookTag, readIndexes } from "./sources.js";

const csv = (v: string | undefined) =>
  v
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function localId(ref: string, project: string): string {
  const i = ref.indexOf(":");
  return i >= 0 && ref.slice(0, i) === project ? ref.slice(i + 1) : ref;
}

/** Read commands see the merged index of local, hub and sibling notebooks (03 §7). */
async function open(deps: CliDeps, g: GlobalOptions) {
  const nb = await loadProject(deps.fs, g.dir);
  return { nb, ...(await readIndexes(deps, nb)) };
}

const meta = (r: IndexedRecord) => ({
  ref: r.id,
  type: r.type,
  status: r.status,
  trust: r.trust,
  title: r.title,
  summary: r.summary,
  file: r.file,
  updated: r.updated,
  ...(r.notebook ? { notebook: r.notebook } : {}),
});

export async function show(
  deps: CliDeps,
  g: GlobalOptions,
  ref: string,
  o: { raw?: boolean; links?: boolean },
): Promise<CommandResult> {
  const { nb, index } = await open(deps, g);
  const id = localId(ref, nb.config.project);
  const rec = index.records.find((r) => r.id === id);
  if (!rec) {
    const missing = index.sources.filter((src) => src.status !== "ok").map((src) => src.label ?? src.name);
    throw new AimemError(
      "NOT_FOUND",
      `record ${ref} not found${missing.length ? ` (not checked: ${missing.join(", ")})` : ""}`,
    );
  }
  const nbTag = rec.notebook ? { notebook: rec.notebook } : {};
  if (o.raw) return { data: { ref: rec.id, file: rec.file, ...nbTag, raw: rec.text }, text: rec.text };
  const links = o.links
    ? rec.links.map((l) => {
        const t = index.records.find((r) => r.id === localId(l, nb.config.project));
        return t
          ? {
              ref: l,
              type: t.type,
              status: t.status,
              trust: t.trust,
              title: t.title,
              summary: t.summary,
              ...(t.notebook ? { notebook: t.notebook } : {}),
            }
          : { ref: l, missing: true };
      })
    : undefined;
  const lines = [
    `${rec.id} [${rec.trust}]${notebookTag(rec)} ${rec.title}`,
    // A hub or sibling file path is relative to that notebook, so name it.
    `${rec.type} · ${rec.status} · ${rec.notebook ? `${rec.notebook}: ` : ""}${rec.file}`,
    rec.summary,
    "",
    rec.body,
  ];
  if (links) {
    lines.push("", "Links:");
    for (const l of links)
      lines.push(
        "missing" in l ? `- ${l.ref} (not found)` : `- ${l.ref} [${l.trust}] ${l.title} — ${l.summary}`,
      );
  }
  return {
    data: {
      ref: rec.id,
      file: rec.file,
      ...nbTag,
      frontmatter: rec.fm,
      body: rec.body,
      ...(links ? { links } : {}),
    },
    text: `${lines.join("\n")}\n`,
  };
}

export async function list(
  deps: CliDeps,
  g: GlobalOptions,
  type: string | undefined,
  o: { status?: string; trust?: string; tag?: string; stale?: boolean },
): Promise<CommandResult> {
  if (type && !(RECORD_TYPES as readonly string[]).includes(type)) {
    throw new AimemError("USAGE", `unknown type '${type}' (expected one of: ${RECORD_TYPES.join(", ")})`);
  }
  const { nb, index } = await open(deps, g);
  const statuses = csv(o.status);
  const tags = csv(o.tag);
  const now = deps.clock.now();
  const recs = index.records.filter(
    (r) =>
      (!type || r.type === type) &&
      (!statuses || statuses.includes(r.status)) &&
      (!o.trust || r.trust === o.trust) &&
      (!tags || tags.some((t) => r.tags.includes(t))) &&
      (!o.stale ||
        (freshnessOf({ ...r.fm, type: r.type, created: r.created }, nb.config, now) !== "fresh" &&
          !RETIRED_STATUSES.has(r.status))),
  );
  // SOURCE appears only when hub or sibling records are listed; single-notebook output is unchanged.
  const multi = recs.some((r) => r.notebook);
  const rows = recs.map((r) =>
    multi
      ? [r.id, r.type, r.status, r.trust, r.notebook ?? "local", r.title]
      : [r.id, r.type, r.status, r.trust, r.title],
  );
  const head = multi
    ? ["ID", "TYPE", "STATUS", "TRUST", "SOURCE", "TITLE"]
    : ["ID", "TYPE", "STATUS", "TRUST", "TITLE"];
  return {
    data: { count: recs.length, records: recs.map(meta) },
    text: recs.length ? table(head, rows) : "No records match.\n",
  };
}

export async function searchCmd(
  deps: CliDeps,
  g: GlobalOptions,
  query: string,
  o: {
    type?: string;
    status?: string;
    tag?: string;
    role?: string;
    repo?: string;
    paths?: string;
    limit: number;
    includeSuperseded?: boolean;
    mode?: string;
  },
): Promise<CommandResult> {
  const { nb, index, local } = await open(deps, g);
  const mode = retrievalMode(nb, o.mode);
  // Vectors cover local records only (3.6 decision 5); other notebooks are scored lexically.
  const sem = await semanticFor(deps, nb, local, query, mode, o.mode !== undefined);
  const warnings = sem.warnings;
  const types = csv(o.type);
  const statuses = csv(o.status);
  const tags = csv(o.tag);
  const roles = csv(o.role);
  const paths = csv(o.paths);
  const retrieved = await searchWithRewrites(
    nb,
    index,
    query,
    {
      limit: o.limit,
      ...(types ? { types } : {}),
      ...(statuses ? { statuses } : {}),
      ...(tags ? { tags } : {}),
      ...(roles ? { roles } : {}),
      ...(paths ? { paths } : {}),
      ...(o.repo ? { repo: o.repo } : {}),
      ...(o.includeSuperseded ? { includeSuperseded: true } : {}),
    },
    {
      ...(await retrievalDeps(deps, nb, local, mode)),
      ...(sem.semantic
        ? {
            semantic: {
              scores: sem.semantic.scores,
              fusion: nb.config.retrieval?.fusion === "rrf" ? ("rrf" as const) : ("weighted" as const),
            },
          }
        : {}),
    },
  );
  const hits = retrieved.hits;
  warnings.push(...retrieved.warnings);
  const data = {
    query,
    mode: sem.semantic ? "hybrid" : "lexical",
    ...(sem.semantic
      ? { semanticModel: sem.semantic.provider, semanticCoverage: sem.semantic.coverage }
      : { semanticReason: sem.off }),
    hits: hits.map((h) => ({ score: Math.round(h.score * 10000) / 10000, ...meta(h.record) })),
  };
  const text = hits.length
    ? `${hits.map((h) => `${h.score.toFixed(2)}  ${h.record.id} [${h.record.trust}]${notebookTag(h.record)} ${h.record.title} — ${h.record.summary}`).join("\n")}\n`
    : "No matches.\n";
  return { data, text, warnings };
}
