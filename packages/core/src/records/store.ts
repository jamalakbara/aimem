import { basename, dirname, join } from "node:path";
import { RECORD_TYPES, type RecordType, TYPE_DIR } from "@aimem/schema";
import type { Fs, Random } from "../ports.js";
import { type ParseResult, parseRecordText, type RecordText, serializeRecord } from "./text.js";

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Write via a temp file in the same directory, then rename over the target, so readers
 * never see a partial file (docs/11 §4). On failure the temp file is removed.
 */
export async function writeFileAtomic(fs: Fs, path: string, data: string, random: Random): Promise<void> {
  const dir = dirname(path);
  await fs.mkdir(dir);
  const tmp = join(dir, `.${basename(path)}.${hex(random.bytes(6))}.tmp`);
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, path);
  } catch (e) {
    await fs.unlink(tmp).catch(() => undefined);
    throw e;
  }
}

export async function readRecordFile(fs: Fs, path: string): Promise<ParseResult> {
  return parseRecordText(await fs.readFile(path));
}

export async function writeRecordFile(fs: Fs, path: string, rec: RecordText, random: Random): Promise<void> {
  await writeFileAtomic(fs, path, serializeRecord(rec), random);
}

export interface RecordFileRef {
  path: string;
  /** Type implied by the directory the file is in. */
  dirType: RecordType;
}

/** Every `.md` file in the type directories of an `.aimem/` folder, sorted by path. */
export async function listRecordFiles(fs: Fs, aimemDir: string): Promise<RecordFileRef[]> {
  const out: RecordFileRef[] = [];
  for (const dirType of RECORD_TYPES) {
    const dir = join(aimemDir, TYPE_DIR[dirType]);
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const n of names) if (n.endsWith(".md")) out.push({ path: join(dir, n), dirType });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
