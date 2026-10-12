import { basename, join } from "node:path";
import { projectSchema, RECORD_TYPES, type RecordType, recordSchema } from "@aimem/schema";
import { describe, expect, it } from "vitest";
import { loadFixture, readYaml } from "./fixture-loader.js";

const DAY = 86_400_000;
const words = (s: string) => (s.match(/\S+/g) ?? []).length;
const staticPrefix = (glob: string) => glob.split(/[*?[{]/)[0] ?? "";

interface Manifest {
  clock: string;
  files: Record<string, string[]>;
  groups: {
    chains: string[][];
    stale: string[];
    expired: string[];
    inferred: string[];
    indonesian: string[];
    paraphrase: string[];
    traps: string[];
  };
}

type FM = Record<string, unknown> & { id: string; type: RecordType; status: string };

const MIN_PER_TYPE: Record<RecordType, number> = {
  decision: 30,
  task: 25,
  memory: 30,
  handoff: 15,
  incident: 5,
  runbook: 5,
  schema: 5,
  testcase: 5,
};

describe("fixture: medium (aimem's own project)", () => {
  const { root, project, files } = loadFixture("medium");
  const manifest = readYaml(join(root, "expected.yaml")) as Manifest;
  const cfg = projectSchema.parse(project);
  const fms = files.map((f) => f.fm as FM);
  const byId = new Map(fms.map((fm) => [fm.id, fm]));
  const clock = Date.parse(manifest.clock);
  const roles = new Set(cfg.roles ?? []);

  /** Expected freshness per 03 §3.3 / §6: window since verified (or created); `expires` wins. */
  function freshness(fm: FM): "fresh" | "stale" | "expired" {
    if (typeof fm.expires === "string" && Date.parse(`${fm.expires}T23:59:59Z`) < clock) return "expired";
    const window = cfg.freshness_days?.[fm.type];
    if (!window) return "fresh";
    const base = Date.parse(
      typeof fm.verified === "string" ? `${fm.verified}T00:00:00Z` : String(fm.created),
    );
    return clock - base > window * DAY ? "stale" : "fresh";
  }

  it("project.yaml describes aimem", () => {
    expect(cfg.project).toBe("aimem");
  });

  it("has 110–130 records with the planned mix of types", () => {
    expect(files.length).toBeGreaterThanOrEqual(110);
    expect(files.length).toBeLessThanOrEqual(130);
    for (const t of RECORD_TYPES)
      expect(files.filter((f) => f.dirType === t).length, t).toBeGreaterThanOrEqual(MIN_PER_TYPE[t]);
  });

  it("every record passes the schema in the right directory, with unique ids and conventional file names", () => {
    expect(new Set(fms.map((fm) => fm.id)).size).toBe(fms.length);
    for (const f of files) {
      expect(f.splitError, f.rel).toBeUndefined();
      const parsed = recordSchema.safeParse(f.fm);
      expect(parsed.success, `${f.rel}: ${parsed.error?.message}`).toBe(true);
      const fm = f.fm as FM;
      expect(fm.type, f.rel).toBe(f.dirType);
      const date = fm.type === "handoff" ? `-${String(fm.created).slice(0, 10).replace(/-/g, "")}` : "";
      expect(basename(f.rel).startsWith(`${fm.id}${date}-`), f.rel).toBe(true);
    }
  });

  it("would pass the validator except for the listed staleness warnings", () => {
    for (const fm of fms) {
      expect(fm.summary, fm.id).not.toBe(fm.title);
      expect(String(fm.summary).length, fm.id).toBeLessThanOrEqual(200);
      for (const r of fm.roles as string[])
        expect(r === "all" || roles.has(r), `${fm.id} role ${r}`).toBe(true);
    }
    for (const f of files) expect(words(f.body), f.rel).toBeLessThanOrEqual(400);
    for (const f of files.filter((x) => x.dirType === "handoff")) {
      for (const s of ["Done", "Not done", "Next", "Blocked", "Notes for next agent"]) {
        expect(new RegExp(`^##\\s+${s}\\s*$`, "m").test(f.body), `${f.rel} ## ${s}`).toBe(true);
      }
    }
  });

  it("all refs resolve and supersede links are consistent both ways", () => {
    for (const fm of fms) {
      const refs = [
        ...((fm.links as string[]) ?? []),
        ...((fm.blocked_by as string[]) ?? []),
        ...((fm.covers as string[]) ?? []),
        ...[fm.supersedes, fm.superseded_by, fm.task].filter((x): x is string => typeof x === "string"),
      ];
      for (const r of refs) expect(byId.has(r), `${fm.id} → ${r}`).toBe(true);
      if (typeof fm.supersedes === "string")
        expect(byId.get(fm.supersedes)?.superseded_by, fm.id).toBe(fm.id);
      if (typeof fm.superseded_by === "string") {
        expect(byId.get(fm.superseded_by)?.supersedes, fm.id).toBe(fm.id);
        expect(fm.status, fm.id).toBe("superseded");
      }
    }
  });

  it("has no unlinked conflicting accepted decisions (V011)", () => {
    const acc = fms.filter((fm) => fm.type === "decision" && fm.status === "accepted");
    for (const [i, a] of acc.entries()) {
      for (const b of acc.slice(i + 1)) {
        const sharedTag = ((a.tags as string[]) ?? []).some((t) => ((b.tags as string[]) ?? []).includes(t));
        const overlap = ((a.paths as string[]) ?? []).some((x) =>
          ((b.paths as string[]) ?? []).some(
            (y) => staticPrefix(x).startsWith(staticPrefix(y)) || staticPrefix(y).startsWith(staticPrefix(x)),
          ),
        );
        const linked =
          ((a.links as string[]) ?? []).includes(b.id) || ((b.links as string[]) ?? []).includes(a.id);
        expect(sharedTag && overlap && !linked, `${a.id} vs ${b.id}`).toBe(false);
      }
    }
  });

  it("manifest lists every file and only expects V010, exactly on stale/expired records", () => {
    expect(Object.keys(manifest.files).sort()).toEqual(files.map((f) => f.rel).sort());
    for (const f of files) {
      const fm = f.fm as FM;
      const expected = freshness(fm) === "fresh" ? [] : ["V010"];
      expect([f.rel, manifest.files[f.rel]]).toEqual([f.rel, expected]);
    }
  });

  it("groups match the records they describe", () => {
    const g = manifest.groups;
    for (const id of Object.values(g).flat(2)) expect(byId.has(id), id).toBe(true);
    expect(g.chains.some((c) => c.length >= 3)).toBe(true);
    expect(g.chains.length).toBeGreaterThanOrEqual(4);
    for (const chain of g.chains) {
      for (let i = 1; i < chain.length; i++)
        expect(byId.get(chain[i] as string)?.supersedes).toBe(chain[i - 1]);
    }
    for (const id of g.stale) {
      expect(freshness(byId.get(id) as FM), id).toBe("stale");
      expect(byId.get(id)?.status, id).toBe("active");
    }
    for (const id of g.expired) expect(freshness(byId.get(id) as FM), id).toBe("expired");
    expect(g.stale.length).toBeGreaterThanOrEqual(6);
    expect(g.expired.length).toBeGreaterThanOrEqual(2);
    expect([...g.inferred].sort()).toEqual(
      fms
        .filter((fm) => fm.trust === "inferred")
        .map((fm) => fm.id)
        .sort(),
    );
    expect(g.inferred.length).toBeGreaterThanOrEqual(4);
    expect(g.indonesian.length).toBeGreaterThanOrEqual(12);
    expect(g.paraphrase.length).toBeGreaterThanOrEqual(8);
    for (const id of g.traps) {
      const fm = byId.get(id) as FM;
      expect(fm.status === "superseded" || fm.trust === "inferred", id).toBe(true);
    }
    // every stale/expired record is in a group; nothing else is stale
    const flagged = fms
      .filter((fm) => freshness(fm) !== "fresh")
      .map((fm) => fm.id)
      .sort();
    expect(flagged).toEqual([...g.stale, ...g.expired].sort());
  });

  it("uses only aimem's real handles and agent authors", () => {
    for (const fm of fms)
      expect(String(fm.author), fm.id).toMatch(/^(human:akbar|agent:[a-z0-9-]+(:[\w.-]+)?)$/);
  });
});
