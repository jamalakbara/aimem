import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cryptoRandom } from "@aimem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cli, FIXTURES, fakeGit } from "./helpers.js";

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
    expect(r.stdout).toMatch(/^16 candidates \(dry run; nothing written\)/);
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
    expect(r.json.data.sources).toEqual(["adr", "agents", "readme", "ci", "schema", "docs"]);
    expect(r.json.data.counts).toEqual({ adr: 3, agents: 5, readme: 5, ci: 1, schema: 1, docs: 1 });
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

  it("rejects unknown sources", async () => {
    const bad = await cli(["adopt", "--dry-run", "--sources", "wiki", "--json", "--dir", dir]);
    expect(bad.code).toBe(2);
    expect(bad.json.error.code).toBe("USAGE");
    expect(bad.json.error.message).toMatch(
      /unknown source 'wiki'; use readme, docs, adr, agents, git, prs, schema, ci/,
    );
    expect(records()).toEqual([]);
  });
});

describe("aimem adopt (M4.2)", () => {
  // The helper's counting random runs out of unique IDs after a dozen records.
  const env = { AIMEM_AUTHOR: "agent:openbot-backend" };
  const random = cryptoRandom;

  it("writes inferred drafts and applies write_policy once for the whole run", async () => {
    const git = fakeGit(undefined, "feature/adopt");
    const r = await cli(["adopt", "--json", "--dir", dir], { env, git, random });
    expect(r.code).toBe(0);
    expect(r.json.data.dryRun).toBe(false);
    expect(r.json.data.written).toHaveLength(16);
    expect(r.json.data.written[0]).toMatchObject({
      type: "decision",
      title: "Use Postgres for parcel state",
    });
    expect(r.json.data.git).toBe("committed");
    const commits = git.calls.filter((c) => c[0] === "commit");
    expect(commits).toHaveLength(1);
    expect(commits[0]).toContain("aimem: adopt 16 records");
    expect(records()).toHaveLength(16);
  });

  it("a second run adds nothing and says so", async () => {
    await cli(["adopt", "--dir", dir], { env, random });
    const r = await cli(["adopt", "--dir", dir], { env, random });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^Nothing new to adopt; 16 candidates are already adopted\./);
    expect(records()).toHaveLength(16);
  });

  it("--max-records caps the run and the output says how many were left out", async () => {
    const r = await cli(["adopt", "--max-records", "5", "--dir", dir], { env, random });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^Adopted 5 records \(trust: inferred, tag adopted\):/);
    expect(r.stdout).toMatch(/11 more candidates were left out by --max-records 5/);
    expect(r.stdout).toMatch(/aimem list --trust inferred/);
    expect(records()).toHaveLength(5);
  });

  it("rejects a bad --max-records", async () => {
    const r = await cli(["adopt", "--max-records", "0", "--json", "--dir", dir], { env });
    expect(r.code).toBe(2);
    expect(records()).toEqual([]);
  });
});
