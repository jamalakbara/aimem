/**
 * Test-only fixture loader. The real frontmatter splitter and record store arrive in
 * slice 1.1 (@aimem/core); this exists so M0 can check fixtures against the schema.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { RECORD_TYPES, type RecordType, TYPE_DIR } from "@aimem/schema";
import YAML from "yaml";

export const FIXTURES = fileURLToPath(new URL("../../../fixtures/projects/", import.meta.url));

const DOC_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

export interface LoadedFile {
  /** Path relative to the fixture root, e.g. `.aimem/decisions/dec-…md`. */
  rel: string;
  /** Type implied by the directory. */
  dirType: RecordType;
  fm: Record<string, unknown> | null;
  body: string;
  splitError?: string;
}

export function split(text: string): { fm: Record<string, unknown> | null; body: string; error?: string } {
  const m = DOC_RE.exec(text);
  if (!m) return { fm: null, body: text, error: "missing frontmatter" };
  try {
    const parsed: unknown = YAML.parse(m[1] ?? "");
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { fm: null, body: m[2] ?? "", error: "frontmatter is not a mapping" };
    }
    return { fm: parsed as Record<string, unknown>, body: m[2] ?? "" };
  } catch (e) {
    return { fm: null, body: m[2] ?? "", error: `invalid YAML: ${(e as Error).message}` };
  }
}

export function loadFixture(name: string): { root: string; project: unknown; files: LoadedFile[] } {
  const root = join(FIXTURES, name);
  const project: unknown = YAML.parse(readFileSync(join(root, ".aimem/project.yaml"), "utf8"));
  const files: LoadedFile[] = [];
  for (const dirType of RECORD_TYPES) {
    const dir = join(root, ".aimem", TYPE_DIR[dirType]);
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names.filter((x) => x.endsWith(".md")).sort()) {
      const path = join(dir, n);
      const { fm, body, error } = split(readFileSync(path, "utf8"));
      files.push({
        rel: relative(root, path).split("\\").join("/"),
        dirType,
        fm,
        body,
        ...(error ? { splitError: error } : {}),
      });
    }
  }
  return { root, project, files };
}

export function readYaml(path: string): unknown {
  return YAML.parse(readFileSync(path, "utf8"));
}
