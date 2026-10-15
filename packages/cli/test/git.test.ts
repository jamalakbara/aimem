import { cpSync, existsSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cli, FIXTURES, fakeGit } from "./helpers.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aimem-cli-git-"));
  cpSync(join(FIXTURES, "tiny"), dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const REMEMBER = [
  "remember",
  "--title",
  "Exports use semicolons",
  "--summary",
  "Bank CSV exports use semicolons.",
  "--body",
  "b",
  "--json",
];

describe("write policy from the CLI", () => {
  it("agent writes in solo mode are committed, touching only the changed files", async () => {
    const git = fakeGit();
    const r = await cli([...REMEMBER, "--dir", dir], { env: { AIMEM_AUTHOR: "agent:claude-code" }, git });
    expect(r.json.data.git).toBe("committed");
    const commit = git.calls.find((c) => c[0] === "commit");
    expect(commit).toEqual([
      "commit",
      "-q",
      "-m",
      `aimem: add ${r.json.data.ref} Exports use semicolons`,
      "-m",
      "Aimem-Author: agent:claude-code",
      "--only",
      "--",
      r.json.data.file,
      ".aimem/INDEX.md",
    ]);
  });

  it("human writes leave git alone", async () => {
    const git = fakeGit();
    const r = await cli([...REMEMBER, "--dir", dir], { env: { AIMEM_AUTHOR: "human:akbar" }, git });
    expect(r.json.data.git).toBe("none");
    expect(git.calls.some((c) => c[0] === "add" || c[0] === "commit")).toBe(false);
  });

  it("the author falls back to git user.name", async () => {
    const r = await cli([...REMEMBER, "--dir", dir], { env: {}, git: fakeGit("Dana Example") });
    expect(r.code).toBe(0);
    expect(r.json.data.trust).toBe("verified");
    const show = await cli(["show", r.json.data.ref, "--json", "--dir", dir]);
    expect(show.json.data.frontmatter.author).toBe("human:dana-example");
  });

  it("git warnings surface in the envelope without failing the command", async () => {
    const git = fakeGit();
    const failing = {
      calls: git.calls,
      run: async (args: string[], cwd: string) =>
        args[0] === "commit" ? { code: 1, stdout: "", stderr: "hook says no\n" } : git.run(args, cwd),
    };
    const r = await cli([...REMEMBER, "--dir", dir], { env: { AIMEM_AUTHOR: "agent:x" }, git: failing });
    expect(r.code).toBe(0);
    expect(r.json.data.git).toBe("failed");
    expect(r.json.warnings.join(" ")).toMatch(/hook says no/);
  });
});

describe("validate --fix", () => {
  it("repairs safe issues, reports them, and validates the result", async () => {
    const decisions = join(dir, ".aimem/decisions");
    renameSync(
      join(decisions, "dec-1a2b3c4d-store-money-as-integer-minor-units.md"),
      join(decisions, "money.md"),
    );
    const r = await cli(["validate", "--fix", "--strict", "--json", "--dir", dir]);
    expect(r.code).toBe(0);
    expect(r.json.data.fixed).toEqual([
      {
        code: "V015",
        file: ".aimem/decisions/money.md",
        action: "renamed to .aimem/decisions/dec-1a2b3c4d-store-money-as-integer-minor-units.md",
      },
    ]);
    expect(r.json.data.issues).toEqual([]);
    expect(existsSync(join(decisions, "dec-1a2b3c4d-store-money-as-integer-minor-units.md"))).toBe(true);
  });

  it("still fails with the issues it could not fix", async () => {
    const messy = mkdtempSync(join(tmpdir(), "aimem-cli-fix-messy-"));
    try {
      cpSync(join(FIXTURES, "messy"), messy, { recursive: true });
      const r = await cli(["validate", "--fix", "--json", "--dir", messy]);
      expect(r.code).toBe(2);
      expect(r.json.error.details.fixed.map((f: { code: string }) => f.code).sort()).toEqual([
        "V007",
        "V015",
      ]);
      expect(r.json.error.details.issues.some((i: { code: string }) => i.code === "V007")).toBe(false);
    } finally {
      rmSync(messy, { recursive: true, force: true });
    }
  });
});
