import { basename, dirname, join, resolve, sep } from "node:path";
import type { Fs } from "@aimem/core";

const MAX_FILE = 10 * 1024 * 1024;

export interface SafeFs {
  fs: Fs;
  /** Entries that were left out, by absolute path, with the reason to show. */
  skipped: Map<string, string>;
}

/**
 * The only way the viewer reads a notebook (24 §5.1 Cache). An entry is checked with `lstat` before it is
 * opened: links, folders, FIFOs, devices and files over 10 MB are never opened. A record file that is left
 * out reads as empty text, so one odd entry cannot stop core from loading the others.
 */
export function safeFs(inner: Fs): SafeFs {
  const skipped = new Map<string, string>();
  const lstat = inner.lstat?.bind(inner);
  const realpath = inner.realpath?.bind(inner);
  if (!lstat || !realpath) throw new Error("the viewer needs lstat and realpath");
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
      const why = await checkFolder(dir);
      if (!why) return inner.readdir(dir);
      skipped.set(dir, why);
      return [];
    },
    readFile: async (given) => {
      const path = resolve(given);
      if (!isRecord(path)) {
        const why = await reject(path);
        if (why) throw new Error(`${basename(path)}: ${why}`);
        return inner.readFile(path);
      }
      let why: string | undefined;
      try {
        why = (await checkFolder(dirname(path))) ?? (await reject(path));
        if (!why) return await inner.readFile(path);
      } catch (e) {
        why = (e as { code?: string }).code === "ENOENT" ? "gone while reading" : "cannot be read";
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
