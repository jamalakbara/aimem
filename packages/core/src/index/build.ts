import { relative } from "node:path";
import { baseFrontmatterSchema, type RecordType } from "@aimem/schema";
import type { Fs } from "../ports.js";
import type { Notebook } from "../project/load.js";
import { listRecordFiles } from "../records/store.js";
import { parseRecordText } from "../records/text.js";

/** A record file as text, path relative to the notebook root. */
export interface RecordSource {
  file: string;
  dirType: RecordType;
  text: string;
}

export interface IndexedRecord {
  id: string;
  type: RecordType;
  status: string;
  trust: string;
  title: string;
  summary: string;
  tags: string[];
  roles: string[];
  repo?: string;
  paths: string[];
  links: string[];
  author: string;
  created: string;
  updated: string;
  /** Full frontmatter, including type-specific and unknown keys. */
  fm: Record<string, unknown>;
  body: string;
  file: string;
  /** Original file text. */
  text: string;
}

export interface IndexProblem {
  file: string;
  message: string;
}

export interface NotebookIndex {
  /** Valid records, ordered by id then file. */
  records: IndexedRecord[];
  /** Files skipped because their header could not be read; `aimem validate` gives details. */
  problems: IndexProblem[];
}

const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** Read every record file of a notebook as text. */
export async function readNotebookFiles(nb: Notebook, fs: Fs): Promise<RecordSource[]> {
  const out: RecordSource[] = [];
  for (const f of await listRecordFiles(fs, nb.dir)) {
    out.push({
      file: relative(nb.root, f.path).split("\\").join("/"),
      dirType: f.dirType,
      text: await fs.readFile(f.path),
    });
  }
  return out;
}

/** Build the in-memory index. Pure; output order does not depend on input order. */
export function buildIndex(sources: RecordSource[]): NotebookIndex {
  const records: IndexedRecord[] = [];
  const problems: IndexProblem[] = [];
  for (const s of sources) {
    const parsed = parseRecordText(s.text);
    if (!parsed.ok) {
      problems.push({ file: s.file, message: parsed.message });
      continue;
    }
    const fm = parsed.record.data;
    const base = baseFrontmatterSchema.safeParse(fm);
    if (!base.success) {
      problems.push({
        file: s.file,
        message: base.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
      });
      continue;
    }
    const b = base.data;
    records.push({
      id: b.id,
      type: b.type,
      status: b.status,
      trust: b.trust,
      title: b.title,
      summary: b.summary,
      tags: strs(b.tags),
      roles: b.roles,
      ...(b.repo ? { repo: b.repo } : {}),
      paths: strs(b.paths),
      links: strs(b.links),
      author: b.author,
      created: b.created,
      updated: b.updated,
      fm,
      body: parsed.record.body,
      file: s.file,
      text: s.text,
    });
  }
  const key = (r: IndexedRecord) => `${r.id}\u0000${r.file}`;
  records.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  problems.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return { records, problems };
}

export async function loadIndex(nb: Notebook, deps: { fs: Fs }): Promise<NotebookIndex> {
  return buildIndex(await readNotebookFiles(nb, deps.fs));
}
