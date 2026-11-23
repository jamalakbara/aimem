import { createHash } from "node:crypto";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import {
  AimemError,
  applyWritePolicy,
  detachRecord,
  documentToRecord,
  loadProject,
  resolveAuthorWithGit,
  upsertExternal,
} from "@aimem/core";
import type { RecordType } from "@aimem/schema";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";
import { writeDeps } from "./embedder.js";

/** 16 §7: default upload limit. */
const MAX_BYTES = 10 * 1024 * 1024;
const TEXT = new Set([".md", ".markdown", ".txt"]);
/** 16 §12: said once per import or sync run. */
export const VISIBILITY_WARNING = "Imported content is visible to everyone who can read this repository";

const who = (deps: CliDeps, g: GlobalOptions, o: { author?: string }) =>
  resolveAuthorWithGit({ ...(o.author ? { flag: o.author } : {}), env: deps.env, git: deps.git, cwd: g.dir });

/**
 * `aimem import <file>` (16 §7, 23 §4b.1): a markdown or text file becomes one externally-owned record
 * (`source.system: upload`). Importing it again updates that record or leaves it alone.
 */
export async function importFile(
  deps: CliDeps,
  g: GlobalOptions,
  file: string,
  o: { as?: string; author?: string; force?: boolean },
): Promise<CommandResult> {
  if (o.as !== undefined && !["auto", "decision", "runbook", "incident", "memory"].includes(o.as))
    throw new AimemError("USAGE", "--as must be auto, decision, runbook, incident or memory");
  const path = resolve(deps.cwd, file);
  const ext = extname(path).toLowerCase();
  if (!TEXT.has(ext))
    throw new AimemError(
      "USAGE",
      `${ext || "extension-less"} files arrive in a later M4b slice; this version imports .md and .txt`,
    );
  const author = await who(deps, g, o);
  const nb = await loadProject(deps.fs, g.dir);
  // A link can point anywhere (QA, #99; adopt skips links since #87): import the target itself.
  if ((await deps.fs.lstat?.(path).catch(() => undefined))?.isSymbolicLink)
    throw new AimemError("USAGE", `${file} is a symlink; import the file it points to instead`);
  const bytes = await deps.fs.readBytes(path).catch(() => {
    throw new AimemError("USAGE", `cannot read ${file}`);
  });
  if (bytes.byteLength > MAX_BYTES) throw new AimemError("USAGE", `${file} is larger than 10 MB`);
  if (bytes.includes(0)) throw new AimemError("USAGE", `${file} looks like a binary file`);
  const text = new TextDecoder().decode(bytes);
  // The source key must survive edits to the file, so it is the path inside the project, not a hash
  // of the content (16 §2.1 said sha256 of the upload; that would duplicate on every change).
  const realRoot = (await deps.fs.realpath?.(nb.root).catch(() => undefined)) ?? nb.root;
  const realPath = (await deps.fs.realpath?.(path).catch(() => undefined)) ?? path;
  const rel = relative(realRoot, realPath).split("\\").join("/");
  // Outside the project two files may share a name: add a hash of the full path, never the path itself.
  const id =
    !rel.startsWith("..") && !isAbsolute(rel)
      ? rel
      : `name:${basename(path)}#${createHash("sha256").update(realPath).digest("hex").slice(0, 12)}`;
  const version = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const doc = documentToRecord(text, basename(path), o.as && o.as !== "auto" ? o.as : undefined);
  const r = await withImportLock(deps, nb.dir, async () =>
    upsertExternal(
      nb,
      {
        type: doc.type as RecordType,
        title: doc.title,
        summary: doc.summary,
        body: doc.body,
        author,
        ...(doc.status ? { status: doc.status } : {}),
        ...(doc.roles ? { roles: doc.roles } : {}),
        ...(doc.tags ? { tags: doc.tags } : {}),
        ...(doc.fields ? { fields: doc.fields } : {}),
        source: { system: "upload", id, url: `file:${id}`, version },
        ...(o.force ? { force: true } : {}),
      },
      await writeDeps(deps, nb),
    ),
  );
  const policy = r.changed.length
    ? await applyWritePolicy({
        git: deps.git,
        nb,
        author,
        files: r.changed,
        message: `aimem: import ${r.ref} ${doc.title}`,
      })
    : { action: "none" as const, warnings: [] };
  const verb = { created: "Created", updated: "Updated", unchanged: "Unchanged" }[r.action];
  return {
    data: {
      action: r.action,
      ref: r.ref,
      type: doc.type,
      title: doc.title,
      trust: r.trust,
      mode: doc.mode,
      file: r.file,
      source: { system: "upload", id, version },
      git: policy.action,
    },
    text: `${verb} ${r.ref} (${doc.type}, ${r.trust}) from ${id}${doc.mode === "whole-document" ? " as a whole document" : ""}.\n`,
    warnings: [
      ...(doc.warning ? [doc.warning] : []),
      ...(doc.notes ?? []),
      ...r.warnings,
      ...policy.warnings,
      VISIBILITY_WARNING,
    ],
  };
}

/** `aimem detach <ref>` (16 §2 rule 3). */
export async function detach(
  deps: CliDeps,
  g: GlobalOptions,
  ref: string,
  o: { author?: string },
): Promise<CommandResult> {
  const author = await who(deps, g, o);
  const nb = await loadProject(deps.fs, g.dir);
  const r = await detachRecord(nb, ref, author, await writeDeps(deps, nb));
  const policy = await applyWritePolicy({
    git: deps.git,
    nb,
    author,
    files: r.changed,
    message: `aimem: detach ${r.ref}`,
  });
  return {
    data: { ref: r.ref, file: r.file, changed: r.changed, git: policy.action },
    text: `Detached ${r.ref}: it is notebook-owned now, and imports or syncs no longer update it.\n`,
    warnings: [...r.warnings, ...policy.warnings],
  };
}

/** A lock older than this belongs to a crashed import. */
const LOCK_STALE_MS = 60_000;

/**
 * One import at a time per notebook, so two runs of the same new file cannot both create a record
 * (QA, #99). Waits up to 20 s for another import to finish.
 */
async function withImportLock<T>(deps: CliDeps, aimemDir: string, f: () => Promise<T>): Promise<T> {
  const exclusive = deps.fs.createExclusive?.bind(deps.fs);
  if (!exclusive) return f();
  const lock = join(aimemDir, ".cache", "import.lock");
  await deps.fs.mkdir(join(aimemDir, ".cache"));
  for (let i = 0; ; i++) {
    try {
      await exclusive(lock, `${process.pid} ${new Date().toISOString()}`);
      break;
    } catch {
      const age = await deps.fs.stat?.(lock).then(
        (st) => Date.now() - st.mtimeMs,
        () => 0,
      );
      if ((age ?? 0) > LOCK_STALE_MS) await deps.fs.unlink(lock).catch(() => undefined);
      else if (i >= 400)
        throw new AimemError("USAGE", "another aimem import is still running in this notebook");
      else await new Promise((done) => setTimeout(done, 50));
    }
  }
  try {
    return await f();
  } finally {
    await deps.fs.unlink(lock).catch(() => undefined);
  }
}
