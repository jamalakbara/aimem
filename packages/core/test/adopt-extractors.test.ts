import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  const d = mkdtempSync(join(tmpdir(), "aimem-extract-"));
  tmp.push(d);
  cpSync(ADOPT_ME, d, { recursive: true });
  return d;
};

describe("adopt extractors: manifests, migrations, CI (M4.2 follow-up)", () => {
  it("turns manifests into a Tech stack fact", async () => {
    const r = await scanProject(nodeFs, ADOPT_ME, { sources: ["readme"] });
    const stack = r.candidates.find((c) => c.title === "Tech stack");
    expect(stack).toMatchObject({
      source: "readme",
      type: "memory",
      kind: "fact",
      tags: ["adopted"],
      evidence: ["Dockerfile", "package.json"],
    });
    expect(stack?.body).toBe(
      [
        "- `package.json` (parcel-hub): dependencies fastify, pg; dev dependencies vitest",
        "- `Dockerfile`: base image node:22-slim",
      ].join("\n"),
    );
    expect(stack?.summary).toBe("Stack from Dockerfile, package.json: fastify, pg, node:22-slim.");
  });

  it("turns SQL migrations into one schema record with tables, columns and comments", async () => {
    const r = await scanProject(nodeFs, ADOPT_ME, { sources: ["schema"] });
    expect(r.candidates).toHaveLength(1);
    const s = r.candidates[0];
    expect(s).toMatchObject({
      source: "schema",
      type: "schema",
      title: "Database schema",
      tags: ["adopted"],
      evidence: ["migrations/001_parcels.sql", "migrations/002_scan_events.sql"],
    });
    expect(s?.summary).toBe("2 tables from 2 migrations: parcels, scan_events.");
    expect(s?.body).toMatch(
      /^## Shape\n\n- `parcels`: id, tracking_code, state, last_event_id\n- `scan_events`: id, parcel_id, scanned_at, payload\n/,
    );
    expect(s?.body).toMatch(
      /## Invariants\n\n- Parcels: one row per parcel; state is folded from scan_events by the worker\. \(migrations\/001_parcels\.sql\)/,
    );
    expect(s?.body).toMatch(
      /## Migration notes\n\n- migrations\/001_parcels\.sql\n- migrations\/002_scan_events\.sql/,
    );
    expect(s?.body).toMatch(/## Gotchas\n\n_Not stated in the migrations\._$/);
  });

  it("turns CI, Makefile and package scripts into a Build and deploy runbook", async () => {
    const r = await scanProject(nodeFs, ADOPT_ME, { sources: ["ci"] });
    expect(r.candidates).toHaveLength(1);
    const rb = r.candidates[0];
    expect(rb).toMatchObject({
      source: "ci",
      type: "runbook",
      title: "Build and deploy",
      tags: ["adopted"],
      evidence: [".github/workflows/ci.yml", "Makefile", "package.json"],
    });
    expect(rb?.body).toBe(
      [
        "## When to use",
        "",
        "Building, testing or deploying the project, as the CI and build files do it.",
        "",
        "## Steps",
        "",
        "- CI `.github/workflows/ci.yml`: `pnpm install`, `pnpm test`",
        "- `make deploy`: `./scripts/deploy.sh $(ENV)`",
        "- `pnpm run dev`: `node src/server.js`",
        "- `pnpm run test`: `vitest run`",
        "- `pnpm run worker`: `node src/worker.js`",
        "",
        "## Rollback",
        "",
        "_Not stated in the build files._",
        "",
        "## Verify",
        "",
        "_Not stated in the build files._",
      ].join("\n"),
    );
  });

  it("skips a project without those files, and reads other manifests and migration folders", async () => {
    const d = mkdtempSync(join(tmpdir(), "aimem-extract-empty-"));
    tmp.push(d);
    mkdirSync(join(d, ".aimem"));
    expect((await scanProject(nodeFs, d, { sources: ["readme", "schema", "ci"] })).candidates).toEqual([]);
    const g = copy();
    writeFileSync(join(g, "go.mod"), "module example.com/parcels\n\ngo 1.23\n");
    mkdirSync(join(g, "db/migrate"), { recursive: true });
    writeFileSync(
      join(g, "db/migrate/003_couriers.sql"),
      "create table if not exists couriers (id uuid primary key, name text);\n",
    );
    const r = await scanProject(nodeFs, g, { sources: ["readme", "schema"] });
    expect(r.candidates.find((c) => c.title === "Tech stack")?.body).toMatch(
      /- `go\.mod`: module example\.com\/parcels, Go 1\.23/,
    );
    expect(r.candidates.find((c) => c.type === "schema")?.body).toMatch(/- `couriers`: id, name/);
  });
});
