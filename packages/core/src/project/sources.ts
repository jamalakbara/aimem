import { join, resolve } from "node:path";
import { PROJECT_DEFAULTS } from "@aimem/schema";
import { type IndexedRecord, loadIndex, type NotebookIndex } from "../index/build.js";
import type { Fs } from "../ports.js";
import { AIMEM_DIR, loadProject, type Notebook } from "./load.js";

/** One notebook of a multi-repo project (03 §7): this repo, the hub, or a sibling repo. */
export interface NotebookSource {
  /** `local`, `hub`, or the sibling repo name. */
  name: string;
  kind: "local" | "hub" | "repo";
  status: "ok" | "missing" | "mismatch";
  /** Label shown on records from this source: `hub` or `repo:<name>`; absent for local. */
  label?: string;
  /** Folder containing `.aimem/`, when found. */
  root?: string;
  /** Why the source was skipped. */
  reason?: string;
  nb?: Notebook;
}

export interface SourceDeps {
  fs: Fs;
  /** `AIMEM_HOME` or `~/.cache/aimem`; checkouts may live in `<cacheHome>/<project>/<name>`. */
  cacheHome?: string;
}

async function exists(fs: Fs, path: string): Promise<boolean> {
  return fs.readFile(path).then(
    () => true,
    () => false,
  );
}

/** Repo name from a Git URL: `git@host:acme/shop-hub.git` → `shop-hub`. */
export function repoNameFromUrl(url: string): string {
  const last =
    url
      .replace(/[/\\]+$/, "")
      .split(/[/:\\]/)
      .pop() ?? url;
  return last.replace(/\.git$/, "");
}

/**
 * Find the hub and sibling notebooks configured in `project.yaml`, without any network access.
 * Never throws: unusable sources are returned with `missing` or `mismatch` and a reason.
 */
export async function resolveSources(nb: Notebook, deps: SourceDeps): Promise<NotebookSource[]> {
  const project = nb.config.project;
  const sources: NotebookSource[] = [{ name: "local", kind: "local", status: "ok", root: nb.root, nb }];
  const wanted: { name: string; kind: "hub" | "repo" }[] = [];
  const hub = nb.config.hub;
  if (hub && nb.config.scope !== "hub") {
    const name = typeof hub.name === "string" && hub.name ? hub.name : repoNameFromUrl(hub.url);
    wanted.push({ name, kind: "hub" });
  }
  for (const r of nb.config.repos ?? []) {
    if (r.name === nb.config.repo) continue;
    wanted.push({ name: r.name, kind: "repo" });
  }
  for (const w of wanted) {
    const label = w.kind === "hub" ? "hub" : `repo:${w.name}`;
    const source: NotebookSource = {
      name: w.kind === "hub" ? "hub" : w.name,
      kind: w.kind,
      label,
      status: "missing",
    };
    if (w.kind === "hub" && hub?.path && hub.path !== PROJECT_DEFAULTS.hub_path) {
      sources.push({ ...source, status: "mismatch", reason: `hub.path '${hub.path}' is not supported yet` });
      continue;
    }
    const candidates = [resolve(nb.root, "..", w.name)];
    if (deps.cacheHome) candidates.push(join(deps.cacheHome, project, w.name));
    const root = (
      await Promise.all(
        candidates.map(async (c) => ((await exists(deps.fs, join(c, AIMEM_DIR, "project.yaml"))) ? c : null)),
      )
    ).find((c): c is string => c !== null && resolve(c) !== resolve(nb.root));
    if (!root) {
      const where = deps.cacheHome ? `../${w.name} or the aimem cache` : `../${w.name}`;
      sources.push({ ...source, reason: `no checkout at ${where}` });
      continue;
    }
    try {
      const other = await loadProject(deps.fs, root);
      if (other.config.project !== project) {
        sources.push({
          ...source,
          root,
          status: "mismatch",
          reason: `project is '${other.config.project}', not '${project}'`,
        });
      } else if (w.kind === "hub" && other.config.scope !== "hub") {
        sources.push({
          ...source,
          root,
          status: "mismatch",
          reason: "not a hub notebook (scope: hub missing)",
        });
      } else {
        sources.push({ ...source, root, status: "ok", nb: other });
      }
    } catch (e) {
      sources.push({
        ...source,
        root,
        status: "mismatch",
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return sources;
}

export interface ProjectIndex extends NotebookIndex {
  sources: NotebookSource[];
  /** IDs found in more than one source; the first source in resolution order wins. */
  duplicates: { id: string; kept: string; skipped: string }[];
}

/** True when `project.yaml` names a hub or other repos, so multi-source output applies. */
export function isMultiRepo(nb: Notebook): boolean {
  return Boolean(
    (nb.config.hub && nb.config.scope !== "hub") || nb.config.repos?.some((r) => r.name !== nb.config.repo),
  );
}

/** Read-only merged index over local → hub → siblings (03 §7). Single-repo projects get the local index. */
export async function loadProjectIndex(nb: Notebook, deps: SourceDeps): Promise<ProjectIndex> {
  const local = await loadIndex(nb, deps);
  if (!isMultiRepo(nb)) {
    return {
      ...local,
      sources: [{ name: "local", kind: "local", status: "ok", root: nb.root, nb }],
      duplicates: [],
    };
  }
  const sources = await resolveSources(nb, deps);
  const records: IndexedRecord[] = [...local.records];
  const owner = new Map(records.map((r) => [r.id, "local"]));
  const duplicates: ProjectIndex["duplicates"] = [];
  for (const source of sources) {
    if (source.kind === "local" || source.status !== "ok" || !source.nb) continue;
    const other = await loadIndex(source.nb, deps);
    for (const r of other.records) {
      const kept = owner.get(r.id);
      if (kept) {
        duplicates.push({ id: r.id, kept, skipped: source.label ?? source.name });
        continue;
      }
      owner.set(r.id, source.label ?? source.name);
      records.push({ ...r, notebook: source.label ?? source.name });
    }
  }
  const key = (r: IndexedRecord) => `${r.id}\u0000${r.notebook ?? ""}\u0000${r.file}`;
  records.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return { records, problems: local.problems, sources, duplicates };
}

/** Warnings for briefings and status: missing or unusable sources, and duplicate IDs. */
export function sourceWarnings(index: ProjectIndex): string[] {
  const out: string[] = [];
  for (const s of index.sources) {
    if (s.status === "missing")
      out.push(`${s.label ?? s.name} is not checked out (${s.reason}); its records are not included.`);
    if (s.status === "mismatch") out.push(`${s.label ?? s.name} was skipped: ${s.reason}.`);
  }
  for (const d of index.duplicates)
    out.push(`${d.id} exists in ${d.kept} and ${d.skipped}; using ${d.kept}.`);
  return out;
}
