import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addRecord,
  cryptoRandom,
  loadIndex,
  loadProject,
  type Notebook,
  nodeFs,
  scanProject,
  validateNotebook,
  writeAdoptDrafts,
} from "../src/index.js";

const ADOPT_ME = fileURLToPath(new URL("../../../fixtures/projects/adopt-me/", import.meta.url));
let dir: string;
let nb: Notebook;
const deps = {
  fs: nodeFs,
  clock: { now: () => new Date("2026-11-22T10:00:00Z") },
  random: cryptoRandom,
};
const agent = "agent:openbot-backend";

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "aimem-drafts-"));
  cpSync(ADOPT_ME, dir, { recursive: true });
  nb = await loadProject(nodeFs, dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const adopt = async (opts: { author?: string; maxRecords?: number } = {}) =>
  writeAdoptDrafts(nb, (await scanProject(nodeFs, dir)).candidates, { author: agent, ...opts }, deps);

describe("adopt drafts (M4.2)", () => {
  it("writes every candidate as an inferred, adopted record with evidence; the notebook validates", async () => {
    const r = await adopt();
    expect(r.written).toHaveLength(13);
    expect(r.cut).toBe(0);
    const index = await loadIndex(nb, { fs: nodeFs });
    expect(index.records).toHaveLength(13);
    for (const rec of index.records) {
      expect(rec.trust).toBe("inferred");
      expect(rec.tags).toContain("adopted");
      expect((rec.fm.evidence as string[]).length).toBeGreaterThan(0);
      expect(rec.fm.verified).toBeUndefined();
    }
    const pg = index.records.find((x) => x.title === "Use Postgres for parcel state");
    expect(pg?.status).toBe("accepted");
    expect(index.records.find((x) => x.title === "Code style")?.fm.kind).toBe("preference");
    expect(index.records.find((x) => x.title === "API conventions")?.paths).toEqual(["src/api/**"]);
    const issues = await validateNotebook(nb, { fs: nodeFs, clock: deps.clock });
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(r.changed).toContain(".aimem/INDEX.md");
  });

  it("is idempotent: a second run adds nothing", async () => {
    await adopt();
    const again = await adopt();
    expect(again.written).toEqual([]);
    expect(again.alreadyAdopted).toBe(13);
    expect(again.sourceChanged).toEqual([]);
  });

  it("keeps human authorship but still marks drafts inferred", async () => {
    await adopt({ author: "human:dana" });
    const index = await loadIndex(nb, { fs: nodeFs });
    expect(index.records.every((x) => x.trust === "inferred" && x.author === "human:dana")).toBe(true);
    expect(index.records.some((x) => x.fm.verified !== undefined)).toBe(false);
  });

  it("caps the run in priority order and reports what was cut", async () => {
    const r = await adopt({ maxRecords: 5 });
    expect(r.written.map((w) => w.source)).toEqual(["adr", "adr", "adr", "agents", "agents"]);
    expect(r.cut).toBe(8);
  });

  it("does not write a second pinned overview", async () => {
    const existing = await addRecord(
      nb,
      {
        type: "memory",
        title: "Project overview",
        summary: "Parcel Hub moves parcels from intake to doorstep.",
        body: "Written by a person.",
        author: "human:dana",
        tags: ["pinned"],
      },
      deps,
    );
    const r = await adopt();
    expect(r.written.some((w) => w.title === "Project overview")).toBe(false);
    expect(r.held).toEqual([
      {
        evidence: "README.md",
        title: "Project overview",
        reason: `the notebook already has a pinned overview (${existing.ref}); compare and update it by hand`,
      },
    ]);
  });

  it("skips a likely duplicate of an existing record", async () => {
    const existing = await addRecord(
      nb,
      {
        type: "decision",
        title: "Use Postgres for parcel state",
        summary: "We picked Postgres 16 for parcel state.",
        body: "## Context\n\nx\n\n## Decision\n\nPostgres.\n\n## Consequences\n\ny",
        author: "human:dana",
      },
      deps,
    );
    const r = await adopt();
    expect(r.held).toContainEqual({
      evidence: "docs/adr/0001-use-postgres.md",
      title: "Use Postgres for parcel state",
      reason: `likely duplicate of ${existing.ref} "Use Postgres for parcel state"`,
    });
    expect(r.written).toHaveLength(12);
  });

  it("reports adopted records whose source changed, without rewriting them", async () => {
    const first = await adopt();
    const style = first.written.find((w) => w.title === "Code style");
    const claude = join(dir, "CLAUDE.md");
    writeFileSync(claude, readFileSync(claude, "utf8").replace("named exports only", "default exports only"));
    const again = await adopt();
    expect(again.written).toEqual([]);
    expect(again.sourceChanged).toEqual([{ ref: style?.ref, evidence: ["CLAUDE.md#code-style"] }]);
    const rec = (await loadIndex(nb, { fs: nodeFs })).records.find((x) => x.id === style?.ref);
    expect(rec?.body).toMatch(/named exports only/);
  });
});
