import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  frontmatterSchema, projectSchema, RECORD_TYPES, SPEC_VERSION, TYPE_DIR, slugify,
  type Frontmatter, type ProjectConfig, type RecordType,
} from "@aimem/schema";
import { AimemError } from "./errors.js";
import { serializeDoc, splitDoc } from "./frontmatter.js";

export type FM = Frontmatter & Record<string, unknown>;
export interface Rec { fm: FM; body: string; file: string; dirType: RecordType }
export interface LoadProblem { file: string; code: "V001" | "V002"; message: string }
export interface Notebook { root: string; dir: string; config: ProjectConfig }

export const AIMEM_DIR = ".aimem";

export function findNotebookDir(start: string): string | null {
  let cur = path.resolve(start);
  for (;;) {
    const cand = path.join(cur, AIMEM_DIR, "project.yaml");
    if (fs.existsSync(cand)) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

export function openNotebook(start: string): Notebook {
  const root = findNotebookDir(start);
  if (!root) throw new AimemError("NOT_INITIALIZED", "No .aimem/ found. Run `aimem init` in your repo.");
  const dir = path.join(root, AIMEM_DIR);
  const raw = YAML.parse(fs.readFileSync(path.join(dir, "project.yaml"), "utf8"));
  const parsed = projectSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AimemError("INVALID_RECORD", `project.yaml invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  if (parsed.data.aimem > SPEC_VERSION) throw new AimemError("SPEC_TOO_NEW", `project.yaml uses spec v${parsed.data.aimem}; this tool supports v${SPEC_VERSION}`);
  return { root, dir, config: parsed.data };
}

export function loadRecords(nb: Notebook): { records: Rec[]; problems: LoadProblem[] } {
  const records: Rec[] = [];
  const problems: LoadProblem[] = [];
  for (const type of RECORD_TYPES) {
    const d = path.join(nb.dir, TYPE_DIR[type]);
    if (!fs.existsSync(d)) continue;
    for (const name of fs.readdirSync(d).sort()) {
      if (!name.endsWith(".md")) continue;
      const file = path.join(d, name);
      const { fm, body, error } = splitDoc(fs.readFileSync(file, "utf8"));
      if (!fm) { problems.push({ file, code: "V001", message: error ?? "invalid frontmatter" }); continue; }
      const parsed = frontmatterSchema.safeParse(fm);
      if (!parsed.success) {
        problems.push({ file, code: "V002", message: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") });
        continue;
      }
      records.push({ fm: { ...fm, ...parsed.data } as FM, body, file, dirType: type });
    }
  }
  return { records, problems };
}

export function recordFileName(fm: Pick<FM, "id" | "title" | "type" | "created">): string {
  const slug = slugify(fm.title);
  if (fm.type === "handoff") return `${fm.id}-${fm.created.slice(0, 10).replace(/-/g, "")}-${slug}.md`;
  return `${fm.id}-${slug}.md`;
}

export function writeAtomic(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/** Write a record. Existing files keep their path (the id is authoritative). */
export function writeRecord(nb: Notebook, rec: { fm: FM; body: string; file?: string }): string {
  const file = rec.file ?? path.join(nb.dir, TYPE_DIR[rec.fm.type], recordFileName(rec.fm));
  writeAtomic(file, serializeDoc(rec.fm, rec.body));
  return file;
}

export function findRecord(records: Rec[], ref: string, project?: string): Rec | undefined {
  const i = ref.indexOf(":");
  const id = i < 0 ? ref : ref.slice(i + 1);
  if (i >= 0 && project && ref.slice(0, i) !== project) return undefined;
  return records.find((r) => r.fm.id === id);
}
