import { createHash } from "node:crypto";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import {
  AimemError,
  applyWritePolicy,
  detachRecord,
  documentToRecord,
  loadProject,
  parseCsv,
  readDocx,
  readXlsx,
  resolveAuthorWithGit,
  sheetToRecords,
  upsertExternal,
  upsertExternalMany,
} from "@aimem/core";
import type { RecordType } from "@aimem/schema";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";
import { writeDeps } from "./embedder.js";
import { lockOwnerAlive } from "./refresh-state.js";

/** 16 §7: default upload limit. */
const MAX_BYTES = 10 * 1024 * 1024;
const TEXT = new Set([".md", ".markdown", ".txt"]);
const DOCX = ".docx";
/** 16 §12: said once per import or sync run. */
export const VISIBILITY_WARNING = "Imported content is visible to everyone who can read this repository";

const who = (deps: CliDeps, g: GlobalOptions, o: { author?: string }) =>
  resolveAuthorWithGit({ ...(o.author ? { flag: o.author } : {}), env: deps.env, git: deps.git, cwd: g.dir });

/** Values of `--as`: document templates (16 §4.2) and sheet templates (16 §4.1). */
const AS_VALUES = ["auto", "decision", "runbook", "incident", "memory", "tasks", "testcases", "incidents"];

/**
 * `aimem import <file>` (16 §7, 23 §4b.1–4b.2): a markdown or text file becomes one externally-owned
 * record, a CSV sheet one record per row (\`source.system: upload\`). Importing again updates those
 * records or leaves them alone.
 */
export async function importFile(
  deps: CliDeps,
  g: GlobalOptions,
  file: string,
  o: {
    as?: string;
    author?: string;
    force?: boolean;
    allowOutside?: boolean;
    strict?: boolean;
    sheet?: string;
  },
): Promise<CommandResult> {
  if (o.as !== undefined && !AS_VALUES.includes(o.as))
    throw new AimemError("USAGE", `--as must be ${AS_VALUES.slice(0, -1).join(", ")} or ${AS_VALUES.at(-1)}`);
  const path = resolve(deps.cwd, file);
  const ext = extname(path).toLowerCase();
  const sheet = ext === ".csv" || ext === ".xlsx";
  if (!TEXT.has(ext) && !sheet && ext !== DOCX)
    throw new AimemError(
      "USAGE",
      `${ext || "extension-less"} files arrive in a later M4b slice; this version imports .md, .txt, .docx, .csv and .xlsx`,
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
  if (ext !== ".xlsx" && ext !== DOCX && bytes.includes(0))
    throw new AimemError("USAGE", `${file} looks like a binary file`);
  let text = ext === ".xlsx" || ext === DOCX ? "" : new TextDecoder().decode(bytes);
  const readNotes: string[] = [];
  if (ext === DOCX) {
    try {
      const d = readDocx(bytes);
      text = d.text;
      if (d.macros) readNotes.push("the document contains macros; they were ignored, not run");
    } catch (e) {
      throw new AimemError("USAGE", `${basename(path)}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!text.trim()) throw new AimemError("USAGE", `${basename(path)} has no text to import`);
  }
  // The source key must survive edits to the file, so it is the path inside the project, not a hash
  // of the content (16 §2.1 said sha256 of the upload; that would duplicate on every change).
  const realRoot = (await deps.fs.realpath?.(nb.root).catch(() => undefined)) ?? nb.root;
  const realPath = (await deps.fs.realpath?.(path).catch(() => undefined)) ?? path;
  const rel = relative(realRoot, realPath).split("\\").join("/");
  const inside = !rel.startsWith("..") && !isAbsolute(rel);
  // An agent can be told to read any file on disk (prompt injection): outside the project it needs an
  // explicit flag (QA, #99). A person importing a file they chose is fine.
  if (!inside && author.startsWith("agent:") && !o.allowOutside)
    throw new AimemError(
      "USAGE",
      `${file} is outside the project; an agent imports it only with --allow-outside`,
    );
  // Outside the project two files may share a name: add a hash of the full path, never the path itself.
  const id = inside
    ? rel
    : `name:${basename(path)}#${createHash("sha256").update(realPath).digest("hex").slice(0, 12)}`;
  const wdeps = await writeDeps(deps, nb);
  if (sheet) {
    let rows: string[][];
    let sheetName: string | undefined;
    let book: ReturnType<typeof readXlsx> | undefined;
    try {
      if (ext === ".xlsx") {
        book = readXlsx(bytes, o.sheet);
        rows = book.rows;
        sheetName = book.sheet;
      } else {
        if (o.sheet) throw new Error("--sheet applies to .xlsx files only");
        rows = parseCsv(text);
      }
    } catch (e) {
      throw new AimemError("USAGE", `${basename(path)}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return importSheet(deps, nb, { rows, sheetName, book, file, id, author, o, wdeps });
  }

  const version = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const asDoc = o.as && !["auto", "tasks", "testcases", "incidents"].includes(o.as) ? o.as : undefined;
  const doc = documentToRecord(text, basename(path), asDoc);
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
      wdeps,
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
      ...readNotes,
      ...(doc.notes ?? []),
      ...r.warnings,
      ...policy.warnings,
      VISIBILITY_WARNING,
    ],
  };
}

/** 16 §4.1: one record per row, keyed by \`(upload, file, row)\`; bad rows are reported, good rows imported. */
async function importSheet(
  deps: CliDeps,
  nb: Awaited<ReturnType<typeof loadProject>>,
  a: {
    rows: string[][];
    sheetName: string | undefined;
    book?: ReturnType<typeof readXlsx> | undefined;
    file: string;
    id: string;
    author: string;
    o: { as?: string; force?: boolean; strict?: boolean };
    wdeps: Awaited<ReturnType<typeof writeDeps>>;
  },
): Promise<CommandResult> {
  let sheet: ReturnType<typeof sheetToRecords>;
  try {
    const hint = a.o.as && ["tasks", "testcases", "incidents"].includes(a.o.as) ? a.o.as : undefined;
    sheet = sheetToRecords(a.rows, basename(a.file), hint, {
      padShortRows: Boolean(a.book),
      date1904: a.book?.date1904 ?? false,
    });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    // A workbook may have the data on another sheet (QA, #101).
    throw new AimemError(
      "USAGE",
      a.book && a.book.sheets.length > 1
        ? `${why} (read sheet '${a.book.sheet}'; sheets: ${a.book.sheets.map((x) => x.name).join(", ")}; pick one with --sheet)`
        : why,
    );
  }
  const counts = { created: 0, updated: 0, unchanged: 0 };
  const errors = [...sheet.errors];
  const warnings: string[] = [
    ...(a.book?.hidden ? [`sheet '${a.book.sheet}' is hidden in the workbook`] : []),
    ...(a.book?.macros ? ["the workbook contains macros; they were ignored, not run"] : []),
    ...sheet.notes.map((n) => `row ${n.row}: ${n.reason}`),
  ];
  const rows: { row: number; ref: string; action: string }[] = [];
  const items = sheet.items.map(({ row, key, record }) => ({
    row,
    input: {
      type: record.type,
      title: record.title,
      summary: record.summary,
      body: record.body,
      author: a.author,
      ...(record.status ? { status: record.status } : {}),
      ...(record.roles ? { roles: record.roles } : {}),
      ...(record.tags ? { tags: record.tags } : {}),
      fields: { ...record.fields, ...(record.paths ? { paths: record.paths } : {}) },
      source: {
        system: "upload" as const,
        // Each worksheet is its own source: rows of another sheet never take over these records (QA, #101).
        id: a.sheetName ? `${a.id}!${a.sheetName}` : a.id,
        url: `file:${a.id}`,
        // With a key column the record follows its key; otherwise its position (QA, #100).
        row: key !== undefined ? `key:${key}` : row,
        version: createHash("sha256").update(JSON.stringify(record)).digest("hex").slice(0, 12),
      },
      ...(a.o.force ? { force: true } : {}),
    },
  }));
  const done = await withImportLock(deps, nb.dir, () =>
    upsertExternalMany(
      nb,
      items.map((i) => i.input),
      a.wdeps,
    ),
  );
  done.results.forEach((r, n) => {
    const row = items[n]?.row ?? 0;
    if ("error" in r) {
      errors.push({ row, reason: `${r.error.code}: ${r.error.message}` });
      return;
    }
    counts[r.action]++;
    rows.push({ row, ref: r.ref, action: r.action });
    if (r.previousTitle !== undefined && !sheet.items[n]?.key)
      warnings.push(
        `row ${row} changed its title from "${r.previousTitle}" to "${items[n]?.input.title}"; row positions shift when rows are inserted or deleted, add a key column to keep them stable`,
      );
  });
  warnings.push(...done.warnings);
  const changed = new Set(done.changed);
  errors.sort((x, y) => x.row - y.row);
  const policy = changed.size
    ? await applyWritePolicy({
        git: deps.git,
        nb,
        author: a.author,
        files: [...changed].sort(),
        message: `aimem: import ${counts.created + counts.updated} ${sheet.type} rows from ${a.id}`,
      })
    : { action: "none" as const, warnings: [] };
  return {
    data: {
      type: sheet.type,
      ...(a.sheetName ? { sheet: a.sheetName } : {}),
      ...counts,
      errors,
      rows,
      source: { system: "upload", id: a.sheetName ? `${a.id}!${a.sheetName}` : a.id },
      git: policy.action,
    },
    text: `${sheet.type} rows from ${a.id}: ${counts.created} created, ${counts.updated} updated, ${counts.unchanged} unchanged${errors.length ? `, ${errors.length} with errors` : ""}.\n`,
    warnings: [
      ...errors.map((e) => `row ${e.row}: ${e.reason}`),
      ...(sheet.extraColumns.length ? [`columns kept in the body: ${sheet.extraColumns.join(", ")}`] : []),
      ...warnings,
      ...policy.warnings,
      VISIBILITY_WARNING,
    ],
    ...(a.o.strict && errors.length ? { exitCode: 1 } : {}),
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

/** A lock older than this belongs to a crashed import, even when its PID cannot be checked. */
const LOCK_STALE_MS = 60_000;

/**
 * One import at a time per notebook, so two runs of the same new file cannot both create a record
 * (QA, #99). A lock whose process is gone is taken over at once (as in #80); otherwise it waits up to
 * 20 s and then says how long the other import's lock still counts.
 */
async function withImportLock<T>(deps: CliDeps, aimemDir: string, f: () => Promise<T>): Promise<T> {
  const exclusive = deps.fs.createExclusive?.bind(deps.fs);
  if (!exclusive) return f();
  const lock = join(aimemDir, ".cache", "import.lock");
  await deps.fs.mkdir(join(aimemDir, ".cache"));
  const waitMs = Number(deps.env.AIMEM_IMPORT_LOCK_WAIT_MS ?? 20_000);
  const tries = Math.max(1, Math.ceil((Number.isFinite(waitMs) ? waitMs : 20_000) / 50));
  for (let i = 0; ; i++) {
    try {
      await exclusive(lock, `${process.pid} ${new Date().toISOString()}`);
      break;
    } catch {
      const age =
        (await deps.fs.stat?.(lock).then(
          (st) => Date.now() - st.mtimeMs,
          () => 0,
        )) ?? 0;
      const owner = await deps.fs.readFile(lock).catch(() => "");
      const pid = Number.parseInt(owner, 10);
      const hasPid = Number.isInteger(pid) && pid > 0;
      // A live owner is never overtaken, however long it runs (QA, #100); a dead owner at once; a lock
      // without a readable PID after 60 s.
      if (hasPid ? !lockOwnerAlive(owner) : age > LOCK_STALE_MS)
        await deps.fs.unlink(lock).catch(() => undefined);
      else if (i >= tries)
        throw new AimemError(
          "USAGE",
          hasPid
            ? `another aimem import (pid ${pid}) is still running in this notebook; try again when it has finished. The lock is .aimem/.cache/import.lock; if no import is running, delete that file`
            : `another aimem import is still running in this notebook (its lock expires in ${Math.max(1, Math.ceil((LOCK_STALE_MS - age) / 1000))} s)`,
        );
      else await new Promise((done) => setTimeout(done, 50));
    }
  }
  try {
    return await f();
  } finally {
    await deps.fs.unlink(lock).catch(() => undefined);
  }
}
