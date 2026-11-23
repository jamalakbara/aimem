import { createHash } from "node:crypto";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
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
  o: { as?: string; author?: string },
): Promise<CommandResult> {
  const path = resolve(deps.cwd, file);
  const ext = extname(path).toLowerCase();
  if (!TEXT.has(ext))
    throw new AimemError(
      "USAGE",
      `${ext || "extension-less"} files arrive in a later M4b slice; this version imports .md and .txt`,
    );
  const author = await who(deps, g, o);
  const nb = await loadProject(deps.fs, g.dir);
  const bytes = await deps.fs.readBytes(path).catch(() => {
    throw new AimemError("USAGE", `cannot read ${file}`);
  });
  if (bytes.byteLength > MAX_BYTES) throw new AimemError("USAGE", `${file} is larger than 10 MB`);
  if (bytes.includes(0)) throw new AimemError("USAGE", `${file} looks like a binary file`);
  const text = new TextDecoder().decode(bytes);
  // The source key must survive edits to the file, so it is the path inside the project, not a hash
  // of the content (16 §2.1 said sha256 of the upload; that would duplicate on every change).
  const rel = relative(nb.root, path).split("\\").join("/");
  const id = !rel.startsWith("..") && !isAbsolute(rel) ? rel : `name:${basename(path)}`;
  const version = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const doc = documentToRecord(text, basename(path), o.as && o.as !== "auto" ? o.as : undefined);
  const r = await upsertExternal(
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
    },
    await writeDeps(deps, nb),
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
    warnings: [...(doc.warning ? [doc.warning] : []), ...r.warnings, ...policy.warnings, VISIBILITY_WARNING],
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
