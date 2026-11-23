import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cryptoRandom,
  loadIndex,
  loadProject,
  markSourcesMissing,
  type Notebook,
  nodeFs,
  upsertExternal,
  verifyRecords,
} from "../src/index.js";

const FIX = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
let dir: string;
let nb: Notebook;
let day = 1;
const deps = {
  fs: nodeFs,
  clock: { now: () => new Date(`2026-11-2${day}T10:00:00Z`) },
  random: cryptoRandom,
};
const body = (d: string) => `## Context\n\nWhy.\n\n## Decision\n\n${d}\n\n## Consequences\n\nSo.`;
const input = (d: string, author = "human:dana", id = "docs/a.md") => ({
  type: "decision" as const,
  title: "Keep events for 90 days",
  summary: "Ninety days.",
  body: body(d),
  author,
  source: { system: "upload" as const, id, url: `file:${id}`, version: d },
});
const rec = async (ref: string) => (await loadIndex(nb, { fs: nodeFs })).records.find((r) => r.id === ref);

beforeEach(async () => {
  day = 1;
  dir = mkdtempSync(join(tmpdir(), "aimem-trust-"));
  cpSync(join(FIX, "projects/tiny"), dir, { recursive: true });
  const y = join(dir, ".aimem/project.yaml");
  writeFileSync(y, readFileSync(y, "utf8").replace("mode: solo", "mode: team"));
  nb = await loadProject(nodeFs, dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("trust of imported records follows the content", () => {
  it("a changed source drops an earlier verification; an unchanged one keeps it", async () => {
    const a = await upsertExternal(nb, input("Ninety days."), deps);
    await verifyRecords(nb, [a.ref], "human:rina", deps);
    expect((await rec(a.ref))?.trust).toBe("verified");
    const same = await upsertExternal(nb, input("Ninety days."), deps);
    expect(same.action).toBe("unchanged");
    expect((await rec(a.ref))?.trust).toBe("verified");
    const b = await upsertExternal(nb, input("Delete everything."), deps);
    expect(b).toMatchObject({ action: "updated", trust: "agent" });
    expect(b.warnings.join("\n")).toMatch(/was verified, but its source changed; it needs review again/);
    const r = await rec(a.ref);
    expect(r?.trust).toBe("agent");
    expect(r?.fm.verified).toBeUndefined();
  });

  it("outside review rules a human's import stays verified with the new date; an agent's becomes agent", async () => {
    const memo = (t: string, author: string) => ({
      ...input(t, author, "docs/m.md"),
      type: "memory" as const,
      body: t,
    });
    const a = await upsertExternal(nb, memo("One.", "human:dana"), deps);
    day = 5;
    await upsertExternal(nb, memo("Two.", "human:dana"), deps);
    expect(await rec(a.ref)).toMatchObject({ trust: "verified", fm: { verified: "2026-11-25" } });
    const c = await upsertExternal(nb, memo("Three.", "agent:claude-code"), deps);
    expect(c.trust).toBe("agent");
    expect((await rec(a.ref))?.fm.verified).toBeUndefined();
  });

  it("a source that went missing and came back unchanged keeps its trust", async () => {
    const a = await upsertExternal(nb, input("Ninety days."), deps);
    await verifyRecords(nb, [a.ref], "human:rina", deps);
    await markSourcesMissing(nb, [a.ref], deps);
    expect((await rec(a.ref))?.fm.source).toMatchObject({ state: "missing" });
    await upsertExternal(nb, input("Ninety days."), deps);
    expect(await rec(a.ref)).toMatchObject({ trust: "verified", fm: { source: { state: "ok" } } });
  });

  it("two clones that import the same source get the same id (QA 19)", async () => {
    const other = mkdtempSync(join(tmpdir(), "aimem-trust2-"));
    try {
      cpSync(join(FIX, "projects/tiny"), other, { recursive: true });
      const nb2 = await loadProject(nodeFs, other);
      const a = await upsertExternal(nb, input("Ninety days."), deps);
      const b = await upsertExternal(nb2, input("Ninety days."), deps);
      expect(a.ref).toBe(b.ref);
      const c = await upsertExternal(
        nb2,
        { ...input("Other.", "human:dana", "docs/b.md"), title: "Paint the dock blue", summary: "Blue." },
        deps,
      );
      expect(c.ref).not.toBe(b.ref);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("roles and tags follow the source too", async () => {
    const a = await upsertExternal(nb, { ...input("Ninety days."), roles: ["dev"], tags: ["one"] }, deps);
    const b = await upsertExternal(nb, { ...input("Ninety days."), roles: ["qa"], tags: ["two"] }, deps);
    expect(b.action).toBe("updated");
    expect(await rec(a.ref)).toMatchObject({ roles: ["qa"], tags: ["two"] });
    await upsertExternal(nb, input("Ninety days."), deps);
    expect(await rec(a.ref)).toMatchObject({ roles: ["all"], tags: [] });
  });
});
