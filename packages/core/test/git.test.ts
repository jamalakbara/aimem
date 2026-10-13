import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addRecord,
  applyWritePolicy,
  effectivePolicy,
  execaGit,
  type Git,
  gitUserName,
  loadProject,
  type Notebook,
  nodeFs,
  resolveAuthorWithGit,
} from "@aimem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";

// Real git, isolated from the developer's global and system config.
const git = execaGit({ GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" });
const clock = { now: () => new Date("2026-10-13T08:00:00Z") };
let n = 0;
const nextByte = () => {
  n += 11;
  return n % 256;
};
const deps = {
  fs: nodeFs,
  clock,
  random: { bytes: (k: number) => Uint8Array.from({ length: k }, nextByte) },
};

let root: string;
async function sh(...args: string[]) {
  const r = await git.run(args, root);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}
async function makeRepo(fixture = "tiny", commitFixture = true): Promise<Notebook> {
  cpSync(join(FIXTURES, fixture), root, { recursive: true });
  await sh("init", "-q", "-b", "main");
  await sh("config", "user.name", "Dana Example");
  await sh("config", "user.email", "dana@example.com");
  await sh("config", "commit.gpgsign", "false");
  if (commitFixture) {
    await sh("add", "-A");
    await sh("commit", "-q", "-m", "fixture");
  }
  return loadProject(nodeFs, root);
}
const memory = (title: string) => ({
  type: "memory" as const,
  title,
  summary: `${title}, explained in one line.`,
  body: "Body.",
  author: "agent:claude-code",
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aimem-git-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("effectivePolicy (03 §6, OQ-4)", () => {
  it.each([
    [{ mode: "solo" }, "commit"],
    [{ mode: "team" }, "stage"],
    [{ mode: "team-realtime" }, "stage"],
    [{ mode: "solo", write_policy: { agent_commits: "none" } }, "none"],
    [{ mode: "team", write_policy: { agent_commits: "pr" } }, "pr"],
  ] as const)("%j → %s", (config, expected) => {
    expect(effectivePolicy(config)).toBe(expected);
  });
});

describe("applyWritePolicy with real git", () => {
  it("solo + agent: commits only the touched files; other staged work stays staged and out of the commit", async () => {
    const nb = await makeRepo();
    writeFileSync(join(root, "unrelated.txt"), "work in progress\n");
    await sh("add", "unrelated.txt");
    const r = await addRecord(nb, memory("Exports use semicolons"), deps);
    const p = await applyWritePolicy({
      git,
      nb,
      author: "agent:claude-code",
      files: r.changed,
      message: `aimem: add ${r.ref} Exports use semicolons`,
    });
    expect(p).toEqual({ action: "committed", warnings: [] });
    expect((await sh("show", "--name-only", "--format=", "HEAD")).split("\n").sort()).toEqual(
      [".aimem/INDEX.md", r.file].sort(),
    );
    expect(await sh("log", "-1", "--format=%s%n%b")).toBe(
      `aimem: add ${r.ref} Exports use semicolons\nAimem-Author: agent:claude-code`,
    );
    expect(await sh("diff", "--cached", "--name-only")).toBe("unrelated.txt");
    expect(await sh("rev-list", "--count", "HEAD")).toBe("2");
  });

  it("team mode stages without committing", async () => {
    const nb = await makeRepo();
    nb.config.mode = "team";
    const r = await addRecord(nb, memory("Exports use semicolons"), deps);
    const p = await applyWritePolicy({
      git,
      nb,
      author: "agent:claude-code",
      files: r.changed,
      message: "m",
    });
    expect(p.action).toBe("staged");
    expect((await sh("diff", "--cached", "--name-only")).split("\n").sort()).toEqual(
      [".aimem/INDEX.md", r.file].sort(),
    );
    expect(await sh("rev-list", "--count", "HEAD")).toBe("1");
  });

  it("pr behaves like stage and says so", async () => {
    const nb = await makeRepo();
    nb.config.write_policy = { agent_commits: "pr" };
    const r = await addRecord(nb, memory("Exports use semicolons"), deps);
    const p = await applyWritePolicy({
      git,
      nb,
      author: "agent:claude-code",
      files: r.changed,
      message: "m",
    });
    expect(p.action).toBe("staged");
    expect(p.warnings.join(" ")).toMatch(/pr/);
  });

  it("none and human authors leave git untouched", async () => {
    const nb = await makeRepo();
    const r = await addRecord(nb, memory("Exports use semicolons"), deps);
    expect(
      (await applyWritePolicy({ git, nb, author: "human:dana", files: r.changed, message: "m" })).action,
    ).toBe("none");
    nb.config.write_policy = { agent_commits: "none" };
    expect(
      (await applyWritePolicy({ git, nb, author: "agent:x", files: r.changed, message: "m" })).action,
    ).toBe("none");
    expect(await sh("diff", "--cached", "--name-only")).toBe("");
    expect(await sh("rev-list", "--count", "HEAD")).toBe("1");
  });

  it("works for the very first commit of an empty repository", async () => {
    const nb = await makeRepo("tiny", false);
    const r = await addRecord(nb, memory("Exports use semicolons"), deps);
    const p = await applyWritePolicy({
      git,
      nb,
      author: "agent:claude-code",
      files: r.changed,
      message: "first",
    });
    expect(p.action).toBe("committed");
    expect(await sh("rev-list", "--count", "HEAD")).toBe("1");
  });

  it("outside a repository: skipped with a warning", async () => {
    cpSync(join(FIXTURES, "tiny"), root, { recursive: true });
    const nb = await loadProject(nodeFs, root);
    const p = await applyWritePolicy({
      git,
      nb,
      author: "agent:x",
      files: [".aimem/INDEX.md"],
      message: "m",
    });
    expect(p.action).toBe("skipped");
    expect(p.warnings[0]).toMatch(/not a git repository/);
  });

  it("git not installed: skipped with a warning", async () => {
    cpSync(join(FIXTURES, "tiny"), root, { recursive: true });
    const nb = await loadProject(nodeFs, root);
    const missing: Git = execaGit({ PATH: join(root, "no-such-bin") });
    const p = await applyWritePolicy({
      git: missing,
      nb,
      author: "agent:x",
      files: [".aimem/INDEX.md"],
      message: "m",
    });
    expect(p.action).toBe("skipped");
    expect(p.warnings[0]).toMatch(/git/);
  });

  it("a failing pre-commit hook: files stay written, warning carries git's message", async () => {
    const nb = await makeRepo();
    mkdirSync(join(root, ".git/hooks"), { recursive: true });
    writeFileSync(join(root, ".git/hooks/pre-commit"), "#!/bin/sh\necho 'hook says no' >&2\nexit 1\n");
    chmodSync(join(root, ".git/hooks/pre-commit"), 0o755);
    const r = await addRecord(nb, memory("Exports use semicolons"), deps);
    const p = await applyWritePolicy({
      git,
      nb,
      author: "agent:claude-code",
      files: r.changed,
      message: "m",
    });
    expect(p.action).toBe("failed");
    expect(p.warnings[0]).toMatch(/hook says no/);
    expect(await sh("rev-list", "--count", "HEAD")).toBe("1");
  });
});

describe("author from git (04 §1)", () => {
  it("reads user.name and turns it into a handle", async () => {
    await makeRepo();
    expect(await gitUserName(git, root)).toBe("Dana Example");
    expect(await resolveAuthorWithGit({ env: {}, git, cwd: root })).toBe("human:dana-example");
  });

  it("flag and AIMEM_AUTHOR still win; no source at all is a USAGE error", async () => {
    await makeRepo();
    expect(
      await resolveAuthorWithGit({ flag: "agent:x", env: { AIMEM_AUTHOR: "agent:y" }, git, cwd: root }),
    ).toBe("agent:x");
    expect(await resolveAuthorWithGit({ env: { AIMEM_AUTHOR: "agent:y" }, git, cwd: root })).toBe("agent:y");
    const outside = mkdtempSync(join(tmpdir(), "aimem-nogit-"));
    try {
      await expect(resolveAuthorWithGit({ env: {}, git, cwd: outside })).rejects.toMatchObject({
        code: "USAGE",
      });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
