import {
  AimemError,
  freshnessOf,
  type IndexedRecord,
  loadIndex,
  loadProject,
  RETIRED_STATUSES,
  search,
} from "@aimem/core";
import { RECORD_TYPES } from "@aimem/schema";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";
import { table } from "../output.js";

const csv = (v: string | undefined) =>
  v
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function localId(ref: string, project: string): string {
  const i = ref.indexOf(":");
  return i >= 0 && ref.slice(0, i) === project ? ref.slice(i + 1) : ref;
}

async function open(deps: CliDeps, g: GlobalOptions) {
  const nb = await loadProject(deps.fs, g.dir);
  return { nb, index: await loadIndex(nb, { fs: deps.fs }) };
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
  if (!rec) throw new AimemError("NOT_FOUND", `record ${ref} not found`);
  if (o.raw) return { data: { ref: rec.id, file: rec.file, raw: rec.text }, text: rec.text };
  const links = o.links
    ? rec.links.map((l) => {
        const t = index.records.find((r) => r.id === localId(l, nb.config.project));
        return t
          ? { ref: l, type: t.type, status: t.status, trust: t.trust, title: t.title, summary: t.summary }
          : { ref: l, missing: true };
      })
    : undefined;
  const lines = [
    `${rec.id} [${rec.trust}] ${rec.title}`,
    `${rec.type} · ${rec.status} · ${rec.file}`,
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
    data: { ref: rec.id, file: rec.file, frontmatter: rec.fm, body: rec.body, ...(links ? { links } : {}) },
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
  const rows = recs.map((r) => [r.id, r.type, r.status, r.trust, r.title]);
  return {
    data: { count: recs.length, records: recs.map(meta) },
    text: recs.length ? table(["ID", "TYPE", "STATUS", "TRUST", "TITLE"], rows) : "No records match.\n",
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
    mode: string;
  },
): Promise<CommandResult> {
  if (o.mode !== "lexical" && o.mode !== "hybrid")
    throw new AimemError("USAGE", `--mode must be lexical or hybrid (got '${o.mode}')`);
  const { index } = await open(deps, g);
  const warnings =
    o.mode === "hybrid" ? ["hybrid search is not available yet (slice 2.3); using lexical"] : [];
  const types = csv(o.type);
  const statuses = csv(o.status);
  const tags = csv(o.tag);
  const roles = csv(o.role);
  const paths = csv(o.paths);
  const hits = search(index, query, {
    limit: o.limit,
    ...(types ? { types } : {}),
    ...(statuses ? { statuses } : {}),
    ...(tags ? { tags } : {}),
    ...(roles ? { roles } : {}),
    ...(paths ? { paths } : {}),
    ...(o.repo ? { repo: o.repo } : {}),
    ...(o.includeSuperseded ? { includeSuperseded: true } : {}),
  });
  const data = {
    query,
    mode: "lexical",
    hits: hits.map((h) => ({ score: Math.round(h.score * 10000) / 10000, ...meta(h.record) })),
  };
  const text = hits.length
    ? `${hits.map((h) => `${h.score.toFixed(2)}  ${h.record.id} [${h.record.trust}] ${h.record.title} — ${h.record.summary}`).join("\n")}\n`
    : "No matches.\n";
  return { data, text, warnings };
}
