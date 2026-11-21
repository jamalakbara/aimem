import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildBriefing,
  loadProject,
  loadProjectIndex,
  nodeFs,
  repoNameFromUrl,
  resolveSources,
  search,
  validateNotebook,
} from "@aimem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";

const NOW = new Date("2026-11-21T00:00:00Z");
const HUB_DECISION = "dec-t1a73qsk";
const DUPLICATE = "mem-qmrpmxdn";
let root: string;
let backend: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aimem-sources-"));
  cpSync(join(FIXTURES, "multirepo"), root, { recursive: true });
  backend = join(root, "backend");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const edit = (file: string, from: string, to: string) =>
  writeFileSync(file, readFileSync(file, "utf8").replace(from, to));

describe("source resolution (03 §7)", () => {
  it("derives repo names from Git URLs", () => {
    expect(repoNameFromUrl("git@github.com:acme/shop-hub.git")).toBe("shop-hub");
    expect(repoNameFromUrl("https://github.com/acme/frontend/")).toBe("frontend");
    expect(repoNameFromUrl("C:\\src\\infra.git")).toBe("infra");
  });

  it("finds the hub and siblings beside the repo and reports a missing one", async () => {
    const sources = await resolveSources(await loadProject(nodeFs, backend), { fs: nodeFs });
    expect(sources.map((s) => [s.name, s.kind, s.status])).toEqual([
      ["local", "local", "ok"],
      ["hub", "hub", "ok"],
      ["frontend", "repo", "ok"],
      ["infra", "repo", "missing"],
    ]);
    expect(sources[3]?.reason).toBe("no checkout at ../infra");
  });

  it("falls back to the cache directory", async () => {
    const cache = join(root, "cache");
    mkdirSync(join(cache, "acme-shop"), { recursive: true });
    renameSync(join(root, "frontend"), join(cache, "acme-shop", "frontend"));
    const nb = await loadProject(nodeFs, backend);
    const sources = await resolveSources(nb, { fs: nodeFs, cacheHome: cache });
    expect(sources.find((s) => s.name === "frontend")).toMatchObject({
      status: "ok",
      root: join(cache, "acme-shop", "frontend"),
    });
  });

  it("skips another project and a hub without scope: hub", async () => {
    edit(join(root, "frontend/.aimem/project.yaml"), "project: acme-shop", "project: other-shop");
    edit(join(root, "shop-hub/.aimem/project.yaml"), "scope: hub", "scope: repo");
    const sources = await resolveSources(await loadProject(nodeFs, backend), { fs: nodeFs });
    expect(sources.find((s) => s.name === "frontend")).toMatchObject({
      status: "mismatch",
      reason: "project is 'other-shop', not 'acme-shop'",
    });
    expect(sources.find((s) => s.name === "hub")).toMatchObject({ status: "mismatch" });
  });
});

describe("merged read-only index", () => {
  it("adds hub and sibling records with labels, local wins on duplicate IDs", async () => {
    const index = await loadProjectIndex(await loadProject(nodeFs, backend), { fs: nodeFs });
    const hub = index.records.find((r) => r.id === HUB_DECISION);
    expect(hub).toMatchObject({ notebook: "hub", title: "Store money as integer cents in every service" });
    const dup = index.records.filter((r) => r.id === DUPLICATE);
    expect(dup).toHaveLength(1);
    expect(dup[0]?.notebook).toBeUndefined();
    expect(index.duplicates).toEqual([
      {
        id: DUPLICATE,
        kept: "local",
        skipped: "repo:frontend",
        file: expect.stringContaining(".aimem/memory/"),
      },
    ]);
    expect(index.records.some((r) => r.notebook === "repo:frontend" && r.title.startsWith("Cart page"))).toBe(
      true,
    );
  });

  it("is the plain local index for a single-repo project", async () => {
    const tiny = await loadProjectIndex(await loadProject(nodeFs, join(FIXTURES, "tiny")), { fs: nodeFs });
    expect(tiny.sources.map((s) => s.name)).toEqual(["local"]);
    expect(tiny.records.every((r) => r.notebook === undefined)).toBe(true);
  });

  it("searches across notebooks and labels the briefing", async () => {
    const nb = await loadProject(nodeFs, backend);
    const index = await loadProjectIndex(nb, { fs: nodeFs });
    const hits = search(index, "integer cents money", { limit: 5 });
    expect(hits[0]?.record).toMatchObject({ id: HUB_DECISION, notebook: "hub" });
    const b = buildBriefing(nb, index, { task: "money in the cart" }, NOW);
    expect(b.markdown).toContain("> sources: local, hub, repo:frontend · missing: repo:infra");
    expect(b.markdown).toContain(`${HUB_DECISION} [verified] [hub] Store money`);
    expect(b.warnings).toContain(
      "repo:infra is not checked out (no checkout at ../infra); its records are not included.",
    );
    expect(b.header.sources).toEqual([
      { name: "local", kind: "local", status: "ok" },
      { name: "hub", kind: "hub", status: "ok" },
      { name: "repo:frontend", kind: "repo", status: "ok" },
      { name: "repo:infra", kind: "repo", status: "missing" },
    ]);
    expect(b.decisions.find((d) => d.ref === HUB_DECISION)?.notebook).toBe("hub");
  });

  it("accepts project-qualified links to other notebooks in validate", async () => {
    const issues = await validateNotebook(await loadProject(nodeFs, backend), {
      fs: nodeFs,
      clock: { now: () => NOW },
    });
    expect(issues.filter((i) => i.code === "V006")).toEqual([]);
  });
});

describe("project-unique IDs on write (03 §7 rule 6)", () => {
  it("does not reuse an ID that exists in another notebook", async () => {
    const { addRecord } = await import("@aimem/core");
    const frontend = join(root, "frontend/.aimem/memory");
    const taken = readFileSync(
      join(frontend, "mem-6y3pjvja-cart-page-shows-cents-divided-by-100.md"),
      "utf8",
    );
    writeFileSync(
      join(frontend, "mem-00000000-zero.md"),
      taken.replace("id: mem-6y3pjvja", "id: mem-00000000").replace(/^title: .*$/m, 'title: "Zero"'),
    );
    let call = 0;
    const random = { bytes: (k: number) => new Uint8Array(k).fill(call++ === 0 ? 0 : 1) };
    const r = await addRecord(
      await loadProject(nodeFs, backend),
      {
        type: "memory",
        title: "Ledger exports are nightly",
        summary: "Exports run every night at two.",
        body: "x",
        author: "human:dana",
      },
      { fs: nodeFs, clock: { now: () => NOW }, random },
    );
    expect(r.ref).toBe("mem-11111111");
  });
});
