import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cryptoRandom } from "@aimem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cli, FIXTURES } from "./helpers.js";

let dir: string;
const random = cryptoRandom;
const env = { AIMEM_AUTHOR: "agent:claude-code" };
const planFile = () => join(dir, ".aimem/.cache/adopt-plan.json");
const plan = () => JSON.parse(readFileSync(planFile(), "utf8"));
const records = () =>
  ["decisions", "memory"].flatMap((d) => {
    try {
      return readdirSync(join(dir, ".aimem", d));
    } catch {
      return [];
    }
  });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aimem-agent-plan-"));
  cpSync(join(FIXTURES, "adopt-me"), dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("aimem adopt --agent-plan (M4.4)", () => {
  it("writes the not-yet-adopted candidates with bodies and prints the agent prompt; no records", async () => {
    const r = await cli(["adopt", "--agent-plan", "--dir", dir], { env, random });
    expect(r.code).toBe(0);
    expect(records()).toEqual([]);
    const p = plan();
    expect(p.version).toBe(1);
    expect(p.project).toBe("parcel-hub");
    expect(p.candidates).toHaveLength(13);
    expect(p.candidates[0]).toMatchObject({
      source: "adr",
      type: "decision",
      title: "Use Postgres for parcel state",
      evidence: ["docs/adr/0001-use-postgres.md"],
      body: expect.stringMatching(/^## Context/),
    });
    expect(r.stdout).toMatch(/13 candidates written to \.aimem\/\.cache\/adopt-plan\.json/);
    expect(r.stdout).toMatch(/For each candidate, read the evidence/);
    expect(r.stdout).toMatch(/keep it under 300 words/i);
    expect(r.stdout).toMatch(/state uncertainty/);
    expect(r.stdout).toMatch(/--evidence/);
  });

  it("leaves out what a previous adopt already wrote", async () => {
    await cli(["adopt", "--max-records", "5", "--dir", dir], { env, random });
    const r = await cli(["adopt", "--agent-plan", "--json", "--dir", dir], { env, random });
    expect(r.code).toBe(0);
    expect(r.json.data).toMatchObject({
      plan: ".aimem/.cache/adopt-plan.json",
      candidates: 8,
      alreadyAdopted: 5,
    });
    expect(plan().candidates).toHaveLength(8);
  });

  it("leaves out drafts a person discarded", async () => {
    const human = { AIMEM_AUTHOR: "human:dana" };
    const w = await cli(["adopt", "--sources", "adr", "--json", "--dir", dir], { env, random });
    const pg = w.json.data.written.find(
      (x: { title: string }) => x.title === "Use Postgres for parcel state",
    );
    expect((await cli(["discard", pg.ref, "--dir", dir], { env: human, random })).code).toBe(0);
    const r = await cli(["adopt", "--agent-plan", "--sources", "adr", "--json", "--dir", dir], {
      env,
      random,
    });
    expect(r.json.data).toMatchObject({ candidates: 0, alreadyAdopted: 2, discarded: 1 });
  });

  it("cannot be combined with --dry-run", async () => {
    const r = await cli(["adopt", "--agent-plan", "--dry-run", "--json", "--dir", dir], { env, random });
    expect(r.code).toBe(2);
    expect(existsSync(planFile())).toBe(false);
  });
});

describe("aimem add --evidence (M4.4)", () => {
  it("an agent-written draft from the plan is inferred, adopted, and counts as adopted next time", async () => {
    const a = await cli(
      [
        "remember",
        "--title",
        "Getting started",
        "--summary",
        "Install Node 22 and pnpm, then run pnpm dev.",
        "--body",
        "Install Node 22 and pnpm. Run pnpm install, set DATABASE_URL, then pnpm dev. Unsure whether Docker is required.",
        "--kind",
        "howto",
        "--evidence",
        "README.md#getting-started",
        "--json",
        "--dir",
        dir,
      ],
      { env, random },
    );
    expect(a.code).toBe(0);
    expect(a.json.data.trust).toBe("inferred");
    const text = readFileSync(join(dir, a.json.data.file), "utf8");
    expect(text).toMatch(
      /evidence: \[README\.md#getting-started\]|evidence:\n {2}- README\.md#getting-started/,
    );
    expect(text).toMatch(/tags: \[adopted\]/);
    const p = await cli(["adopt", "--agent-plan", "--json", "--dir", dir], { env, random });
    expect(p.json.data.alreadyAdopted).toBe(1);
    expect(plan().candidates.map((c: { title: string }) => c.title)).not.toContain("Getting started");
  });
});
