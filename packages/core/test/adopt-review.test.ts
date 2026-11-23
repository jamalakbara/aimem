import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addRecord,
  cryptoRandom,
  discardRecord,
  loadIndex,
  loadProject,
  type Notebook,
  nodeFs,
  reviewQueue,
  scanProject,
  summarizeNotebook,
  supersedeRecord,
  verifyRecords,
  writeAdoptDrafts,
} from "../src/index.js";

const ADOPT_ME = fileURLToPath(new URL("../../../fixtures/projects/adopt-me/", import.meta.url));
let dir: string;
let nb: Notebook;
let now = new Date("2026-11-22T10:00:00Z");
const deps = { fs: nodeFs, clock: { now: () => now }, random: cryptoRandom };
const index = () => loadIndex(nb, { fs: nodeFs });

beforeEach(async () => {
  now = new Date("2026-11-22T10:00:00Z");
  dir = mkdtempSync(join(tmpdir(), "aimem-review-"));
  cpSync(ADOPT_ME, dir, { recursive: true });
  nb = await loadProject(nodeFs, dir);
  const scan = await scanProject(nodeFs, dir, { sources: ["adr"] });
  await writeAdoptDrafts(nb, scan.candidates, { author: "agent:openbot-backend" }, deps);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const decision = (title: string, author: string) =>
  addRecord(
    nb,
    {
      type: "decision",
      title,
      summary: `${title}.`,
      body: "## Context\n\nx\n\n## Decision\n\ny\n\n## Consequences\n\nz",
      author,
    },
    deps,
  );

describe("review queue (M4.5)", () => {
  it("lists inferred drafts first, then unreviewed agent records; verified records and handoffs stay out", async () => {
    const agentRec = await decision("Cache parcel lookups for a minute", "agent:claude-code");
    await decision("Keep the API stateless", "human:dana");
    const q = reviewQueue(nb, await index(), now);
    expect(q.map((i) => [i.title, i.reasons])).toEqual([
      ["Fold scans in a worker", ["inferred"]],
      ["Use Postgres for parcel state", ["inferred"]],
      ["Cache parcel lookups for a minute", ["unreviewed"]],
    ]);
    // "Store scans as events" is superseded (from its ADR): retired records need no review.
    expect(q[0]?.evidence).toEqual(["docs/adr/0003-fold-scans-in-a-worker.md"]);
    expect(q[2]?.ref).toBe(agentRec.ref);
  });

  it("drops a record from the queue once a person verifies it", async () => {
    const first = reviewQueue(nb, await index(), now)[0];
    await verifyRecords(nb, [String(first?.ref)], "human:dana", deps);
    expect(reviewQueue(nb, await index(), now).map((i) => i.ref)).not.toContain(first?.ref);
  });
});

describe("aimem discard (M4.5)", () => {
  it("deletes a never-verified draft that nothing links to, and regenerates INDEX.md", async () => {
    const q = reviewQueue(nb, await index(), now);
    const target = q.find((i) => i.title === "Use Postgres for parcel state");
    const r = await discardRecord(nb, String(target?.ref), "human:dana", deps);
    expect(r.changed).toEqual([target?.file, ".aimem/adopt-discarded", ".aimem/INDEX.md"]);
    expect(existsSync(join(dir, String(target?.file)))).toBe(false);
    expect((await index()).records.some((x) => x.id === target?.ref)).toBe(false);
  });

  it("refuses agents, verified records and records that others link to", async () => {
    const q = reviewQueue(nb, await index(), now);
    const ref = String(q[0]?.ref);
    await expect(discardRecord(nb, ref, "agent:claude-code", deps)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: `only a human can discard records; ask a person on the team to run aimem discard ${ref}`,
    });
    const linked = String(q[1]?.ref);
    const linker = await addRecord(
      nb,
      {
        type: "memory",
        title: "Read the scan ADR first",
        summary: "Context for scans.",
        body: "See the ADR.",
        author: "human:dana",
        links: [linked],
      },
      deps,
    );
    await expect(discardRecord(nb, linked, "human:dana", deps)).rejects.toMatchObject({
      code: "INVALID_RECORD",
      message: `${linked} is linked from ${linker.ref}; supersede it instead of discarding it`,
    });
    await verifyRecords(nb, [ref], "human:rina", deps);
    await expect(discardRecord(nb, ref, "human:dana", deps)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: `${ref} was verified; only never-verified records can be discarded (supersede it instead)`,
    });
  });
});

describe("review debt and the supersede rule (08 §2.2)", () => {
  it("status lists inferred records older than 60 days as review debt", async () => {
    now = new Date("2027-01-31T10:00:00Z");
    const s = summarizeNotebook(nb, await index(), now);
    expect(s.reviewDebt.map((r) => r.title).sort()).toEqual([
      "Fold scans in a worker",
      "Use Postgres for parcel state",
    ]);
    now = new Date("2026-12-01T10:00:00Z");
    expect(summarizeNotebook(nb, await index(), now).reviewDebt).toEqual([]);
  });

  it("an inferred decision cannot be the basis of an accepted supersede", async () => {
    const own = await decision("Keep parcel state in one table", "human:dana");
    const inferred = reviewQueue(nb, await index(), now).find((i) => i.status === "accepted");
    await expect(supersedeRecord(nb, own.ref, String(inferred?.ref), deps)).rejects.toMatchObject({
      code: "USAGE",
      message: `${inferred?.ref} is inferred (adopted, not reviewed); verify it before it supersedes an accepted decision`,
    });
  });
});

describe("discard safety from the QA plan (M4.5)", () => {
  it("records a discarded draft so the next adopt does not bring it back (QA 7)", async () => {
    const pg = reviewQueue(nb, await index(), now).find((i) => i.title === "Use Postgres for parcel state");
    const r = await discardRecord(nb, String(pg?.ref), "human:dana", deps);
    expect(r.changed).toContain(".aimem/adopt-discarded");
    expect(readFileSync(join(dir, ".aimem/adopt-discarded"), "utf8")).toMatch(
      /^docs\/adr\/0001-use-postgres\.md$/m,
    );
    const scan = await scanProject(nodeFs, dir, { sources: ["adr"] });
    const again = await writeAdoptDrafts(nb, scan.candidates, { author: "agent:openbot-backend" }, deps);
    expect(again.written).toEqual([]);
    expect(again.discarded).toBe(1);
  });

  it("refuses a move stub and an externally owned record (QA 5)", async () => {
    const q = reviewQueue(nb, await index(), now);
    const stub = join(dir, String(q[0]?.file));
    writeFileSync(
      stub,
      readFileSync(stub, "utf8").replace("trust: inferred", "trust: inferred\nmoved_to: hub"),
    );
    await expect(discardRecord(nb, String(q[0]?.ref), "human:dana", deps)).rejects.toMatchObject({
      code: "INVALID_RECORD",
      message: `${q[0]?.ref} is a pointer to a moved record; discard it where it lives now`,
    });
    const ext = join(dir, String(q[1]?.file));
    writeFileSync(
      ext,
      readFileSync(ext, "utf8").replace(
        "trust: inferred",
        [
          "trust: inferred",
          "managed_by: external",
          "source:",
          "  system: google-doc",
          "  id: doc-1",
          "  url: https://docs.example.com/doc-1",
          "  version: 1",
          `  content_sha: "${"0".repeat(64)}"`,
          "  synced_at: 2026-11-01T09:00:00Z",
          "  imported_by: human:dana",
          "  state: ok",
        ].join("\n"),
      ),
    );
    await expect(discardRecord(nb, String(q[1]?.ref), "human:dana", deps)).rejects.toMatchObject({
      code: "READONLY_EXTERNAL",
    });
    await expect(discardRecord(nb, "../../etc/passwd", "human:dana", deps)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("possible duplicates in the review queue (M4 gap)", () => {
  it("lists the newer record of a likely-duplicate pair once, naming the older one", async () => {
    const older = await decision("Keep the API stateless", "human:dana");
    now = new Date("2026-11-23T10:00:00Z");
    // Duplicates arrive through --force or merged branches; addRecord itself refuses them.
    const newer = await addRecord(
      nb,
      {
        type: "decision",
        title: "Keep the API stateless always",
        summary: "Keep the API stateless always.",
        body: "## Context\n\nx\n\n## Decision\n\ny\n\n## Consequences\n\nz",
        author: "human:rina",
        force: true,
      },
      deps,
    );
    const q = reviewQueue(nb, await index(), now);
    const dup = q.filter((i) => i.reasons.includes("duplicate"));
    expect(dup).toHaveLength(1);
    expect(dup[0]).toMatchObject({ ref: newer.ref, duplicateOf: older.ref, reasons: ["duplicate"] });
    expect(q.at(-1)?.ref).toBe(newer.ref);
  });
});
