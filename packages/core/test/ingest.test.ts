import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addRecord,
  contentSha,
  cryptoRandom,
  detachRecord,
  documentToRecord,
  loadIndex,
  loadProject,
  type Notebook,
  nodeFs,
  supersedeRecord,
  updateRecord,
  upsertExternal,
  validateNotebook,
  verifyRecords,
} from "../src/index.js";

const FIX = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const read = (name: string) => readFileSync(join(FIX, "imports", name), "utf8");
let dir: string;
let nb: Notebook;
const now = new Date("2026-11-23T10:00:00Z");
const deps = { fs: nodeFs, clock: { now: () => now }, random: cryptoRandom };
const index = () => loadIndex(nb, { fs: nodeFs });

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "aimem-ingest-"));
  cpSync(join(FIX, "projects/tiny"), dir, { recursive: true });
  nb = await loadProject(nodeFs, dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const source = (id: string, version = "v1") => ({
  system: "upload" as const,
  id,
  url: `file:${id}`,
  version,
});

describe("document templates (16 §4.2)", () => {
  it("maps a decision doc: title, status, sections, roles, tags, alternatives", () => {
    const r = documentToRecord(read("decision.md"), "decision.md");
    expect(r).toMatchObject({
      type: "decision",
      title: "Store parcel events for 90 days",
      summary: "Scan events are kept for 90 days, then archived to cold storage.",
      status: "accepted",
      roles: ["dev", "devops"],
      tags: ["retention", "storage"],
      mode: "template",
    });
    expect(r.body).toBe(
      [
        "## Context",
        "",
        "Scan events grow by 2 GB a month and slow down the fold worker.",
        "",
        "## Decision",
        "",
        "Keep 90 days in Postgres and move older events to object storage every night.",
        "",
        "## Consequences",
        "",
        "Support can only replay the last 90 days without a restore.",
        "",
        "## Alternatives",
        "",
        "Partitioning by month (more operational work).",
      ].join("\n"),
    );
  });

  it("maps runbook and incident docs, including incident severity", () => {
    const rb = documentToRecord(read("runbook.md"), "runbook.md");
    expect(rb).toMatchObject({ type: "runbook", title: "Rotate the courier API key", mode: "template" });
    expect(rb.body).toMatch(/^## When to use\n\nEvery 90 days/);
    const inc = documentToRecord(read("incident.md"), "incident.md");
    expect(inc).toMatchObject({ type: "incident", fields: { severity: "sev2" }, mode: "template" });
    expect(inc.body).toMatch(/## Root cause\n\nThe worker did not back off/);
  });

  it("falls back to a whole-document reference memory, with a warning", () => {
    const r = documentToRecord(read("notes.txt"), "notes.txt");
    expect(r).toMatchObject({
      type: "memory",
      title: "Weekly ops sync notes",
      fields: { kind: "reference" },
      mode: "whole-document",
    });
    expect(r.body).toBe(read("notes.txt").trim());
    expect(r.warning).toMatch(/no template matched; imported as a whole document/);
  });

  it("a requested type with missing headings falls back with a warning that names them", () => {
    const r = documentToRecord(read("runbook.md"), "runbook.md", "decision");
    expect(r.mode).toBe("whole-document");
    expect(r.warning).toMatch(/missing headings for decision: Context, Decision, Consequences/);
  });
});

describe("upsert by source key (16 §2.1)", () => {
  const input = (body: string, version = "v1") => ({
    ...documentToRecord(read("decision.md"), "decision.md"),
    body,
    author: "human:dana",
    source: source("docs/decision.md", version),
  });

  it("creates once, leaves an unchanged import alone, updates a changed one in place", async () => {
    const a = await upsertExternal(
      nb,
      input("## Context\n\nA\n\n## Decision\n\nB\n\n## Consequences\n\nC"),
      deps,
    );
    expect(a.action).toBe("created");
    const rec = (await index()).records.find((r) => r.id === a.ref);
    expect(rec?.fm).toMatchObject({
      managed_by: "external",
      trust: "verified",
      source: {
        system: "upload",
        id: "docs/decision.md",
        version: "v1",
        content_sha: contentSha(rec?.body ?? ""),
        imported_by: "human:dana",
        state: "ok",
      },
    });
    const same = await upsertExternal(
      nb,
      input("## Context\n\nA\n\n## Decision\n\nB\n\n## Consequences\n\nC"),
      deps,
    );
    expect(same).toMatchObject({ action: "unchanged", ref: a.ref, changed: [] });
    const b = await upsertExternal(
      nb,
      input("## Context\n\nA2\n\n## Decision\n\nB\n\n## Consequences\n\nC", "v2"),
      deps,
    );
    expect(b).toMatchObject({ action: "updated", ref: a.ref });
    const recs = (await index()).records.filter((r) => r.fm.managed_by === "external");
    expect(recs).toHaveLength(1);
    expect(recs[0]?.body).toMatch(/A2/);
    expect((recs[0]?.fm.source as { version?: string } | undefined)?.version).toBe("v2");
    const issues = await validateNotebook(nb, { fs: nodeFs, clock: deps.clock });
    expect(issues.filter((i) => ["V017", "V018"].includes(i.code))).toEqual([]);
  });

  it("an agent import is trust agent", async () => {
    const r = await upsertExternal(
      nb,
      {
        ...input("## Context\n\nA\n\n## Decision\n\nB\n\n## Consequences\n\nC"),
        author: "agent:claude-code",
      },
      deps,
    );
    expect((await index()).records.find((x) => x.id === r.ref)?.trust).toBe("agent");
  });
});

describe("externally-owned records refuse local edits; detach is the way out", () => {
  const imported = async () =>
    upsertExternal(
      nb,
      {
        ...documentToRecord(read("decision.md"), "decision.md"),
        author: "agent:claude-code",
        source: source("docs/decision.md"),
      },
      deps,
    );

  it("refuses update and supersede in both directions, but allows verify", async () => {
    const ext = await imported();
    await expect(
      updateRecord(nb, ext.ref, { set: { status: "rejected" }, author: "human:dana" }, deps),
    ).rejects.toMatchObject({
      code: "READONLY_EXTERNAL",
    });
    const own = await addRecord(
      nb,
      {
        type: "decision",
        title: "Keep events in Kafka",
        summary: "Kafka.",
        body: "## Context\n\nx\n\n## Decision\n\ny\n\n## Consequences\n\nz",
        author: "human:dana",
      },
      deps,
    );
    await expect(supersedeRecord(nb, ext.ref, own.ref, deps)).rejects.toMatchObject({
      code: "READONLY_EXTERNAL",
    });
    await expect(supersedeRecord(nb, own.ref, ext.ref, deps)).rejects.toMatchObject({
      code: "READONLY_EXTERNAL",
    });
    await expect(
      addRecord(
        nb,
        {
          type: "decision",
          title: "Keep events for a year",
          summary: "A year.",
          body: "## Context\n\nx\n\n## Decision\n\ny\n\n## Consequences\n\nz",
          author: "human:dana",
          supersedes: ext.ref,
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: "READONLY_EXTERNAL" });
    await verifyRecords(nb, [ext.ref], "human:rina", deps);
    expect((await index()).records.find((r) => r.id === ext.ref)?.trust).toBe("verified");
  });

  it("detach makes it notebook-owned, notes where it came from, and later sync ignores it", async () => {
    const ext = await imported();
    const d = await detachRecord(nb, ext.ref, "human:dana", deps);
    expect(d.changed).toContain(d.file);
    const rec = (await index()).records.find((r) => r.id === ext.ref);
    expect(rec?.fm.managed_by).toBeUndefined();
    expect(rec?.fm.source).toBeUndefined();
    expect(rec?.body).toMatch(
      /Detached from upload docs\/decision\.md \(version v1\) on 2026-11-23 by human:dana\./,
    );
    // Sync no longer owns it: importing the same document again is a likely duplicate, not an update.
    await expect(imported()).rejects.toMatchObject({ code: "DUPLICATE_LIKELY" });
    await updateRecord(nb, ext.ref, { set: { status: "rejected" }, author: "human:dana" }, deps);
    await expect(detachRecord(nb, ext.ref, "human:dana", deps)).rejects.toMatchObject({ code: "USAGE" });
  });
});
