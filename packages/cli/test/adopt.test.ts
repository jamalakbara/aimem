import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cli, FIXTURES } from "./helpers.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aimem-cli-adopt-"));
  cpSync(join(FIXTURES, "adopt-me"), dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const records = () =>
  ["decisions", "memory", "runbooks", "schema"].flatMap((d) => {
    try {
      return readdirSync(join(dir, ".aimem", d));
    } catch {
      return [];
    }
  });

describe("aimem adopt --dry-run (M4.1)", () => {
  it("lists candidates grouped by source and writes nothing", async () => {
    const r = await cli(["adopt", "--dry-run", "--dir", dir]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^13 candidates \(dry run; nothing written\)/);
    expect(r.stdout).toMatch(
      /\nadr \(3\)\n {2}decision {2}accepted {2}Use Postgres for parcel state {2}docs\/adr\/0001-use-postgres\.md\n/,
    );
    expect(r.stdout).toMatch(/\nagents \(5\)\n/);
    expect(records()).toEqual([]);
  });

  it("returns the JSON contract", async () => {
    const r = await cli(["adopt", "--dry-run", "--json", "--dir", dir]);
    expect(r.code).toBe(0);
    expect(Object.keys(r.json.data)).toEqual(["dryRun", "sources", "counts", "candidates", "skipped"]);
    expect(r.json.data.dryRun).toBe(true);
    expect(r.json.data.sources).toEqual(["adr", "agents", "readme", "docs"]);
    expect(r.json.data.counts).toEqual({ adr: 3, agents: 5, readme: 4, docs: 1 });
    expect(r.json.data.candidates[0]).toEqual({
      source: "adr",
      type: "decision",
      title: "Use Postgres for parcel state",
      summary:
        "Chosen option: Postgres 16, because it gives us transactions, JSONB for courier payloads, and the team already runs it.",
      status: "accepted",
      tags: ["adopted"],
      evidence: ["docs/adr/0001-use-postgres.md"],
    });
    expect(r.json.data.candidates[0].body).toBeUndefined();
  });

  it("--sources limits the scan; later-slice sources warn", async () => {
    const r = await cli(["adopt", "--dry-run", "--sources", "adr,git", "--json", "--dir", dir]);
    expect(r.code).toBe(0);
    expect(r.json.data.counts).toEqual({ adr: 3 });
    expect(r.json.warnings).toEqual(["source git is not implemented yet (later M4 slices); skipped"]);
  });

  it("rejects unknown sources and runs without --dry-run until drafts land", async () => {
    const bad = await cli(["adopt", "--dry-run", "--sources", "wiki", "--json", "--dir", dir]);
    expect(bad.code).toBe(2);
    expect(bad.json.error.code).toBe("USAGE");
    expect(bad.json.error.message).toMatch(
      /unknown source 'wiki'; use readme, docs, adr, agents, git, prs, schema, ci/,
    );
    const write = await cli(["adopt", "--json", "--dir", dir]);
    expect(write.code).toBe(2);
    expect(write.json.error.message).toMatch(/only --dry-run is available/);
    expect(records()).toEqual([]);
  });
});
