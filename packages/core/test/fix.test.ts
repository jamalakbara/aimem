import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixNotebook, loadProject, nodeFs, validateNotebook } from "@aimem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXTURES, fixedRandom } from "./helpers.js";

const clock = { now: () => new Date("2026-10-13T08:00:00Z") };
const deps = { fs: nodeFs, clock, random: fixedRandom(5) };
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aimem-fix-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const codes = async (nb: Awaited<ReturnType<typeof loadProject>>) =>
  [
    ...new Set(
      (
        await validateNotebook(nb, { fs: nodeFs, clock: { now: () => new Date("2026-10-12T00:00:00Z") } })
      ).map((i) => i.code),
    ),
  ].sort();

describe("fixNotebook (validate --fix, 04)", () => {
  it("repairs a hand-renamed file and a one-sided supersede link, leaving a clean notebook", async () => {
    cpSync(join(FIXTURES, "tiny"), root, { recursive: true });
    const dir = join(root, ".aimem/decisions");
    renameSync(join(dir, "dec-1a2b3c4d-store-money-as-integer-minor-units.md"), join(dir, "money.md"));
    const oldFile = join(dir, "dec-2b3c4d5e-store-amounts-as-floating-point.md");
    writeFileSync(
      oldFile,
      readFileSync(oldFile, "utf8")
        .replace("superseded_by: dec-1a2b3c4d\n", "")
        .replace("status: superseded", "status: accepted"),
    );
    const nb = await loadProject(nodeFs, root);
    expect(await codes(nb)).toEqual(["V007", "V015"]);

    const r = await fixNotebook(nb, deps);
    expect(r.fixed).toEqual([
      {
        code: "V015",
        file: ".aimem/decisions/money.md",
        action: "renamed to .aimem/decisions/dec-1a2b3c4d-store-money-as-integer-minor-units.md",
      },
      {
        code: "V007",
        file: ".aimem/decisions/dec-2b3c4d5e-store-amounts-as-floating-point.md",
        action: "set superseded_by: dec-1a2b3c4d, status: superseded",
      },
    ]);
    expect(existsSync(join(dir, "money.md"))).toBe(false);
    const fixed = readFileSync(oldFile, "utf8");
    expect(fixed).toContain("superseded_by: dec-1a2b3c4d\n");
    expect(fixed).toContain("updated: 2026-10-13T08:00:00Z\n");
    expect(await codes(nb)).toEqual([]);
  });

  it("fills a missing supersedes on the newer record", async () => {
    cpSync(join(FIXTURES, "tiny"), root, { recursive: true });
    const file = join(root, ".aimem/decisions/dec-1a2b3c4d-store-money-as-integer-minor-units.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("supersedes: dec-2b3c4d5e\n", ""));
    const nb = await loadProject(nodeFs, root);
    const r = await fixNotebook(nb, deps);
    expect(r.fixed.map((f) => f.action)).toEqual(["set supersedes: dec-2b3c4d5e"]);
    expect(await codes(nb)).toEqual([]);
  });

  it("sets updated to created when it is earlier", async () => {
    cpSync(join(FIXTURES, "tiny"), root, { recursive: true });
    const file = join(root, ".aimem/memory/mem-6f7g8h9j-monthly-reports-must-reconcile-to-the-cent.md");
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace("updated: 2026-10-01T09:15:00Z", "updated: 2026-01-01T00:00:00Z"),
    );
    const nb = await loadProject(nodeFs, root);
    const r = await fixNotebook(nb, deps);
    expect(r.fixed).toEqual([
      {
        code: "updated",
        file: ".aimem/memory/mem-6f7g8h9j-monthly-reports-must-reconcile-to-the-cent.md",
        action: "set updated: 2026-10-01T09:15:00Z",
      },
    ]);
  });

  it("rewrites backslashes in adapters.files to / (03 §10), keeping comments and dropping duplicates", async () => {
    cpSync(join(FIXTURES, "tiny"), root, { recursive: true });
    const yaml = join(root, ".aimem/project.yaml");
    writeFileSync(
      yaml,
      `${readFileSync(yaml, "utf8")}# extra agent files\nadapters:\n  files: ['docs\\AI.md', docs/AI.md, 'notes\\team\\x.md', README.md]\n`,
    );
    const nb = await loadProject(nodeFs, root);
    const r = await fixNotebook(nb, deps);
    expect(r.fixed).toEqual([
      {
        code: "paths",
        file: ".aimem/project.yaml",
        action: "adapters.files: docs\\AI.md → docs/AI.md, notes\\team\\x.md → notes/team/x.md",
      },
    ]);
    const text = readFileSync(yaml, "utf8");
    expect(text).toContain("# extra agent files\n");
    expect(text).toContain("files: [docs/AI.md, notes/team/x.md, README.md]");
    expect((await fixNotebook(await loadProject(nodeFs, root), deps)).fixed).toEqual([]);
  });

  it("on messy: fixes V007 and V015, leaves everything it cannot safely fix", async () => {
    cpSync(join(FIXTURES, "messy"), root, { recursive: true });
    const nb = await loadProject(nodeFs, root);
    const before = await codes(nb);
    const r = await fixNotebook(nb, deps);
    expect(r.fixed.map((f) => f.code).sort()).toEqual(["V007", "V015"]);
    const after = await codes(nb);
    expect(after).not.toContain("V007");
    expect(after).not.toContain("V015");
    expect(after).toEqual(before.filter((c) => c !== "V007" && c !== "V015"));
  });

  it("does nothing on a clean notebook and never overwrites an existing file", async () => {
    cpSync(join(FIXTURES, "tiny"), root, { recursive: true });
    const nb = await loadProject(nodeFs, root);
    expect((await fixNotebook(nb, deps)).fixed).toEqual([]);
    const dir = join(root, ".aimem/memory");
    cpSync(join(dir, "mem-5e6f7g8h-payment-provider-sends-amounts-as-strings.md"), join(dir, "copy.md"));
    const r = await fixNotebook(nb, deps);
    expect(r.fixed).toEqual([]);
    expect(r.skipped).toEqual([
      {
        code: "V015",
        file: ".aimem/memory/copy.md",
        reason:
          "target .aimem/memory/mem-5e6f7g8h-payment-provider-sends-amounts-as-strings.md already exists",
      },
    ]);
  });
});
