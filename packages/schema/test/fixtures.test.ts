import { basename, join } from "node:path";
import { baseFrontmatterSchema, isValidSlug, projectSchema, recordSchema, TYPE_PREFIX } from "@aimem/schema";
import { describe, expect, it } from "vitest";
import { FIXTURES, type LoadedFile, loadFixture, readYaml } from "./fixture-loader.js";

const ALL_CODES = Array.from({ length: 18 }, (_, i) => `V${String(i + 1).padStart(3, "0")}`);
/** Codes the schema layer alone can detect; the rest are checked by the 1.2 validator. */
const SCHEMA_CODES = new Set(["V001", "V002", "V003", "V004", "V005"]);

/** Schema-level problems for a set of files, keyed by relative path. */
function schemaCodes(files: LoadedFile[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>(files.map((f) => [f.rel, new Set<string>()]));
  const ids = new Map<string, string[]>();
  for (const f of files) {
    const codes = out.get(f.rel) as Set<string>;
    if (!f.fm) {
      codes.add("V001");
      continue;
    }
    if (!baseFrontmatterSchema.safeParse(f.fm).success) {
      codes.add("V002");
      continue;
    }
    if (f.fm.type !== f.dirType) codes.add("V003");
    else if (!recordSchema.safeParse(f.fm).success) codes.add("V004");
    const id = String(f.fm.id);
    ids.set(id, [...(ids.get(id) ?? []), f.rel]);
  }
  for (const rels of ids.values()) if (rels.length > 1) for (const r of rels) out.get(r)?.add("V005");
  return out;
}

describe("fixture: tiny", () => {
  const { project, files } = loadFixture("tiny");
  const fms = files.map((f) => f.fm as Record<string, unknown>);

  it("project.yaml parses", () => {
    expect(projectSchema.safeParse(project).success).toBe(true);
  });

  it("has 8 records, 2 per core type", () => {
    expect(files).toHaveLength(8);
    for (const t of ["decision", "task", "memory", "handoff"]) {
      expect(files.filter((f) => f.dirType === t)).toHaveLength(2);
    }
  });

  it("every record passes the schema with no schema-level problems", () => {
    for (const [rel, codes] of schemaCodes(files)) expect([rel, [...codes]]).toEqual([rel, []]);
  });

  it("file names are <id>-<slug>.md (handoffs: <id>-<yyyymmdd>-<slug>.md)", () => {
    for (const f of files) {
      const fm = f.fm as Record<string, unknown>;
      const name = basename(f.rel, ".md");
      const prefix =
        fm.type === "handoff"
          ? `${fm.id}-${String(fm.created).slice(0, 10).replace(/-/g, "")}-`
          : `${fm.id}-`;
      expect(name.startsWith(prefix), f.rel).toBe(true);
      expect(isValidSlug(name.slice(prefix.length)), f.rel).toBe(true);
      expect(String(fm.id).startsWith(`${TYPE_PREFIX[f.dirType]}-`)).toBe(true);
    }
  });

  it("all links, supersede refs and blockers resolve, and supersede pairs are consistent", () => {
    const byId = new Map(fms.map((fm) => [fm.id as string, fm]));
    for (const fm of fms) {
      const refs = [
        ...((fm.links as string[]) ?? []),
        ...((fm.blocked_by as string[]) ?? []),
        ...[fm.supersedes, fm.superseded_by, fm.task].filter((x): x is string => typeof x === "string"),
      ];
      for (const r of refs) expect(byId.has(r), `${fm.id} → ${r}`).toBe(true);
      if (typeof fm.supersedes === "string") expect(byId.get(fm.supersedes)?.superseded_by).toBe(fm.id);
    }
  });

  it("covers the features later tests rely on", () => {
    expect(fms.some((fm) => (fm.tags as string[] | undefined)?.includes("pinned"))).toBe(true);
    expect(fms.some((fm) => fm.supersedes)).toBe(true);
    expect(fms.some((fm) => fm.type === "task" && fm.priority === "p1")).toBe(true);
    expect(new Set(fms.map((fm) => fm.trust)).size).toBeGreaterThan(1);
  });
});

describe("fixture: messy", () => {
  const { root, project, files } = loadFixture("messy");
  const manifest = readYaml(join(root, "expected.yaml")) as {
    clock: string;
    files: Record<string, string[]>;
  };

  it("project.yaml parses", () => {
    expect(projectSchema.safeParse(project).success).toBe(true);
  });

  it("manifest lists every record file, only known codes, and covers every code", () => {
    expect(Object.keys(manifest.files).sort()).toEqual(files.map((f) => f.rel).sort());
    const used = new Set(Object.values(manifest.files).flat());
    for (const c of used) expect(ALL_CODES).toContain(c);
    expect([...used].sort()).toEqual(ALL_CODES);
    expect(manifest.clock).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("schema-detectable codes match the manifest exactly", () => {
    for (const [rel, codes] of schemaCodes(files)) {
      const expected = (manifest.files[rel] ?? []).filter((c) => SCHEMA_CODES.has(c)).sort();
      expect([rel, [...codes].sort()]).toEqual([rel, expected]);
    }
  });
});

it("fixtures directory resolves", () => {
  expect(FIXTURES.endsWith("/fixtures/projects/")).toBe(true);
});
