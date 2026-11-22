import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { nodeFs, scanProject } from "../src/index.js";

const ADOPT_ME = fileURLToPath(new URL("../../../fixtures/projects/adopt-me/", import.meta.url));
const tmp: string[] = [];
afterEach(() => {
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});
const copy = () => {
  const d = mkdtempSync(join(tmpdir(), "aimem-adopt-"));
  tmp.push(d);
  cpSync(ADOPT_ME, d, { recursive: true });
  return d;
};

describe("adopt scan (M4.1)", () => {
  it("finds ADRs, agent-instruction sections, the overview and how-to sections, each with evidence", async () => {
    const r = await scanProject(nodeFs, ADOPT_ME);
    const rows = r.candidates.map((c) => [c.source, c.type, c.title, c.evidence.join(",")]);
    expect(rows).toEqual([
      ["adr", "decision", "Use Postgres for parcel state", "docs/adr/0001-use-postgres.md"],
      ["adr", "decision", "Store scans as events", "docs/adr/0002-event-sourcing-for-scans.md"],
      ["adr", "decision", "Fold scans in a worker", "docs/adr/0003-fold-scans-in-a-worker.md"],
      ["agents", "memory", "API conventions", ".cursor/rules/api.mdc"],
      ["agents", "memory", "Time zones", ".github/copilot-instructions.md#time-zones"],
      ["agents", "memory", "Migrations", "AGENTS.md#migrations"],
      ["agents", "memory", "Code style", "CLAUDE.md#code-style"],
      ["agents", "memory", "Testing", "CLAUDE.md#testing"],
      ["readme", "memory", "Project overview", "README.md"],
      ["readme", "memory", "Getting started", "README.md#getting-started"],
      ["readme", "memory", "Running tests", "README.md#running-tests"],
      ["readme", "memory", "Deployment", "README.md#deployment"],
      ["docs", "memory", "Local development", "docs/architecture.md#local-development"],
    ]);
    expect(r.candidates.every((c) => c.evidence.length > 0 && c.tags.includes("adopted"))).toBe(true);
    expect(r.skipped).toEqual([]);
  });

  it("maps ADR status and fills the decision sections", async () => {
    const r = await scanProject(nodeFs, ADOPT_ME, { sources: ["adr"] });
    expect(r.candidates.map((c) => c.status)).toEqual(["accepted", "superseded", "accepted"]);
    const pg = r.candidates[0];
    expect(pg?.body).toMatch(/^## Context\n\nWe need durable storage/);
    expect(pg?.body).toMatch(/## Decision\n\nChosen option: Postgres 16/);
    expect(pg?.body).toMatch(/## Consequences\n\n\* Good, because one datastore/);
    expect(pg?.summary).toBe(
      "Chosen option: Postgres 16, because it gives us transactions, JSONB for courier payloads, and the team already runs it.",
    );
  });

  it("keeps agent-instruction sections verbatim, tagged imported, and skips the aimem block", async () => {
    const r = await scanProject(nodeFs, ADOPT_ME, { sources: ["agents"] });
    const style = r.candidates.find((c) => c.title === "Code style");
    expect(style?.body).toBe(
      "- Use named exports only.\n- Never log full courier payloads; they contain phone numbers.",
    );
    expect(style?.kind).toBe("preference");
    expect(style?.tags).toEqual(["adopted", "imported"]);
    expect(r.candidates.find((c) => c.title === "Testing")?.kind).toBe("howto");
    expect(JSON.stringify(r.candidates)).not.toMatch(/managed by aimem/);
    expect(r.candidates.find((c) => c.title === "API conventions")?.paths).toEqual(["src/api/**"]);
  });

  it("marks the overview pinned and summarises the README intro", async () => {
    const r = await scanProject(nodeFs, ADOPT_ME, { sources: ["readme"] });
    const o = r.candidates[0];
    expect(o?.tags).toEqual(["adopted", "pinned"]);
    expect(o?.summary).toBe("Parcel Hub tracks parcels from warehouse intake to doorstep delivery.");
  });

  it("is deterministic", async () => {
    expect(await scanProject(nodeFs, ADOPT_ME)).toEqual(await scanProject(nodeFs, ADOPT_ME));
  });

  it("skips files over 200 KB and drops candidates with a likely secret, naming only the file", async () => {
    const d = copy();
    writeFileSync(join(d, "docs/huge.md"), `# Huge\n\n## Setup\n\n${"x".repeat(210 * 1024)}\n`);
    const key = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
    writeFileSync(join(d, "docs/ops.md"), `# Ops\n\n## Deploy steps\n\nUse key ${key} for the bucket.\n`);
    const r = await scanProject(nodeFs, d, { sources: ["docs"] });
    expect(r.skipped).toEqual([
      { evidence: "docs/huge.md", reason: "file larger than 200 KB" },
      { evidence: "docs/ops.md#deploy-steps", reason: "possible secret (aws-access-key, line 5)" },
    ]);
    expect(JSON.stringify(r)).not.toContain(key);
  });

  it("ignores headings inside code fences and the .aimem directory", async () => {
    const d = copy();
    writeFileSync(join(d, "docs/fence.md"), "# Fence\n\n## 2. Build\n\n```sh\n## not a heading\nmake\n```\n");
    writeFileSync(join(d, ".aimem/README.md"), "# Notebook\n\n## Setup\n\nignored\n");
    const r = await scanProject(nodeFs, d, { sources: ["docs", "readme"] });
    const build = r.candidates.find((c) => c.title === "Build");
    expect(build?.body).toBe("```sh\n## not a heading\nmake\n```");
    expect(r.candidates.some((c) => c.evidence[0]?.startsWith(".aimem"))).toBe(false);
  });
});
