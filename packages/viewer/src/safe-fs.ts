import { basename, dirname, join, resolve, sep } from "node:path";
import { AimemError, type Fs } from "@aimem/core";

const MAX_FILE = 10 * 1024 * 1024;

const codeOf = (e: unknown) => (e as { code?: string } | null)?.code;
const REASONS: Record<string, string> = {
  ENOENT: "gone while reading",
  ELOOP: "a link; not read",
  ENOTREG: "not a regular file; not read",
  EFBIG: "larger than 10 MB; not read",
};
const reasonOf = (e: unknown) => REASONS[codeOf(e) ?? ""] ?? "cannot be read";

export interface SafeFs {
  fs: Fs;
  /** Entries that were left out, by absolute path, with the reason to show. */
  skipped: Map<string, string>;
}

/**
 * The only way the viewer reads a notebook (24 §5.1 Cache). An entry is checked with `lstat` before it is
 * opened, and the opened file again: links, folders, FIFOs, devices and files over 10 MB are never read. An
 * `.aimem` that is a link is not followed. A record file that is left out reads as empty text, so one odd entry
 * cannot stop core from loading the others.
 */
export function safeFs(inner: Fs): SafeFs {
  const skipped = new Map<string, string>();
  const lstat = inner.lstat?.bind(inner);
  const realpath = inner.realpath?.bind(inner);
  const readRegular = inner.readRegular?.bind(inner);
  if (!lstat || !realpath || !readRegular)
    throw new Error("the viewer needs lstat, realpath and readRegular");
  const readOnly = async (): Promise<never> => {
    throw new Error("the viewer is read-only");
  };

  /** `<root>/.aimem/<type folder>`: undefined when it is a real folder inside its own `.aimem/`. */
  const folders = new Map<string, Promise<string | undefined>>();
  const checkFolder = (dir: string) => {
    const known = folders.get(dir);
    if (known) return known;
    const check = (async () => {
      const s = await lstat(dir);
      if (s.isSymbolicLink) return "linked folder; not read";
      if (!s.isDirectory) return "not a folder; not read";
      if ((await lstat(dirname(dir))).isSymbolicLink) return ".aimem is a link; not read";
      const top = await realpath(dirname(dir));
      return (await realpath(dir)).startsWith(top.endsWith(sep) ? top : top + sep)
        ? undefined
        : "outside its notebook; not read";
    })();
    folders.set(dir, check);
    return check;
  };
  const isRecord = (path: string) => path.endsWith(".md") && basename(dirname(dirname(path))) === ".aimem";
  const reject = async (path: string): Promise<string | undefined> => {
    const s = await lstat(path);
    if (s.isSymbolicLink) return "a link; not read";
    if (!s.isFile) return "not a regular file; not read";
    if ((s.size ?? 0) > MAX_FILE) return "larger than 10 MB; not read";
    return undefined;
  };

  const fs: Fs = {
    lstat,
    realpath,
    readdir: async (given) => {
      const dir = resolve(given);
      if (basename(dirname(dir)) !== ".aimem") return inner.readdir(dir);
      let why: string | undefined;
      try {
        why = await checkFolder(dir);
        if (!why) return await inner.readdir(dir);
      } catch (e) {
        // Most notebooks do not have every type folder.
        if (codeOf(e) === "ENOENT") return [];
        why = "cannot be listed";
      }
      skipped.set(dir, why);
      return [];
    },
    readFile: async (given) => {
      const path = resolve(given);
      if (!isRecord(path)) {
        const name = `.aimem/${basename(path)}`;
        if ((await lstat(dirname(path))).isSymbolicLink)
          throw new AimemError("INVALID_RECORD", ".aimem is a link; the viewer does not follow it");
        const why = await reject(path);
        if (why) throw new AimemError("INVALID_RECORD", `${name}: ${why}`);
        try {
          return await readRegular(path, MAX_FILE);
        } catch (e) {
          throw new AimemError("INVALID_RECORD", `${name}: ${reasonOf(e)}`);
        }
      }
      let why: string | undefined;
      try {
        why = (await checkFolder(dirname(path))) ?? (await reject(path));
        if (!why) return await readRegular(path, MAX_FILE);
      } catch (e) {
        why = reasonOf(e);
      }
      skipped.set(path, why);
      return "";
    },
    readBytes: readOnly,
    writeFile: readOnly,
    rename: readOnly,
    unlink: readOnly,
    mkdir: readOnly,
  };
  return { fs, skipped };
}

/** The notebook folder at or above `start`, found without opening anything. */
export async function findRoot(inner: Fs, start: string): Promise<string | undefined> {
  for (let cur = resolve(start); ; cur = dirname(cur)) {
    if (await inner.lstat?.(join(cur, ".aimem", "project.yaml")).catch(() => undefined)) return cur;
    if (dirname(cur) === cur) return undefined;
  }
}
