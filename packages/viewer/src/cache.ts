import { join, relative, sep } from "node:path";
import {
  AIMEM_DIR,
  AimemError,
  type Clock,
  type Fs,
  type IndexProblem,
  listRecordFiles,
  loadProject,
  loadProjectIndex,
  type Notebook,
  type ProjectIndex,
  resolveSources,
  sourceWarnings,
} from "@aimem/core";
import { safeFs } from "./safe-fs.js";

export interface Snapshot {
  nb: Notebook;
  index: ProjectIndex;
  /** Files that are not shown, with the reason; hub and sibling files carry their label. */
  problems: IndexProblem[];
  /** Missing checkouts and duplicate ids. */
  warnings: string[];
  /** Set when the newest state could not be read and this is an older one. */
  stale?: string;
}

export interface CacheDeps {
  fs: Fs;
  clock: Clock;
  cacheHome: string;
  /** Folder that contains `.aimem/`. */
  root: string;
  /** How long a request waits for a load. */
  loadMs?: number;
}

/** Reads the notebook when it changed, at most once at a time, and keeps the last good state. */
export class IndexCache {
  private good?: { key: string; snapshot: Snapshot };
  private running?: { promise: Promise<Snapshot>; since: number };
  constructor(private readonly deps: CacheDeps) {}

  async get(): Promise<Snapshot> {
    const limit = this.deps.loadMs ?? 10_000;
    if (!this.running) {
      const promise = this.refresh().finally(() => {
        this.running = undefined;
      });
      this.running = { promise, since: performance.now() };
    }
    const { promise, since } = this.running;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, fail) => {
          // A read that hangs stays the one load; later requests do not start another or wait again.
          timer = setTimeout(
            () => fail(new Error("reading the notebook takes too long")),
            Math.max(0, since + limit - performance.now()),
          );
        }),
      ]);
    } catch (e) {
      if (!this.good) throw e;
      const why = e instanceof AimemError ? `: ${e.message.split("\n")[0]}` : "";
      return { ...this.good.snapshot, stale: `The viewer could not refresh${why}. This may be out of date.` };
    } finally {
      clearTimeout(timer);
    }
  }

  private async refresh(): Promise<Snapshot> {
    const key = await this.signature();
    if (this.good?.key === key) return this.good.snapshot;
    let snapshot = await this.load();
    let after = await this.signature();
    if (after !== key) {
      snapshot = await this.load();
      // Not read again after this: if it still changes, the next request sees another signature.
      const again = await this.signature();
      if (again !== after) after = "";
    }
    this.good = { key: after, snapshot };
    return snapshot;
  }

  private async project(fs: Fs): Promise<Notebook> {
    const { root } = this.deps;
    // Core looks in parent folders too; the viewer must not switch to another notebook on its own.
    if (!(await fs.lstat?.(join(root, AIMEM_DIR, "project.yaml")).catch(() => undefined)))
      throw new AimemError("NOT_INITIALIZED", "the notebook is gone");
    const nb = await loadProject(fs, root);
    if (nb.root !== root) throw new AimemError("INVALID_RECORD", "project.yaml is not a regular file");
    return nb;
  }

  /** Changes whenever a record or project.yaml of any source changes, also when size and mtime stay. */
  private async signature(): Promise<string> {
    const { fs } = safeFs(this.deps.fs);
    const nb = await this.project(fs);
    const sources = await resolveSources(nb, { fs, cacheHome: this.deps.cacheHome });
    const parts: unknown[] = [];
    for (const s of sources) {
      parts.push([s.name, s.kind, s.status, s.reason, s.root]);
      if (s.status !== "ok" || !s.nb) continue;
      const files = [
        join(s.nb.dir, "project.yaml"),
        ...(await listRecordFiles(fs, s.nb.dir)).map((f) => f.path),
      ];
      parts.push(
        await Promise.all(
          files.map(async (f) => {
            const st = await fs.lstat?.(f).catch(() => undefined);
            return [f, st?.mtimeMs, st?.ctimeMs, st?.size, st?.ino, st?.isFile];
          }),
        ),
      );
    }
    return JSON.stringify(parts);
  }

  private async load(): Promise<Snapshot> {
    const { fs, skipped } = safeFs(this.deps.fs);
    const nb = await this.project(fs);
    const index = await loadProjectIndex(nb, { fs, cacheHome: this.deps.cacheHome });
    const left: IndexProblem[] = [...skipped].map(([path, message]) => {
      const home = index.sources.find((s) => s.root && path.startsWith(s.root + sep));
      const file = home?.root ? relative(home.root, path).split(sep).join("/") : "a file";
      return { file: home?.label ? `${home.label}: ${file}` : file, message };
    });
    const names = new Set(left.map((p) => p.file));
    return {
      nb,
      index,
      problems: [...index.problems.filter((p) => !names.has(p.file)), ...left].sort((a, b) =>
        a.file < b.file ? -1 : a.file > b.file ? 1 : 0,
      ),
      warnings: sourceWarnings(index),
    };
  }
}
