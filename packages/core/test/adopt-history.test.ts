import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execaGit, nodeFs, scanProject } from "../src/index.js";

const ADOPT_ME = fileURLToPath(new URL("../../../fixtures/projects/adopt-me/", import.meta.url));
const git = execaGit({
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
});
let dir: string;
const run = async (...args: string[]) => {
  const r = await git.run(args, dir);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const commit = async (file: string, text: string, message: string) => {
  writeFileSync(join(dir, file), text);
  await run("add", "-A");
  await run("commit", "-q", "-m", message);
  return run("rev-parse", "--short", "HEAD");
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "aimem-history-"));
  cpSync(ADOPT_ME, dir, { recursive: true });
  await run("init", "-q", "-b", "main");
  await run("add", "-A");
  await run("commit", "-q", "-m", "initial import");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("adopt git source (M4.3)", () => {
  it("lists change hotspots and turns repeated fixes and reverts into gotchas with commit evidence", async () => {
    const a = await commit(
      "src/server.js",
      "export const server = 1;\n",
      "fix: parse tracking codes with dashes",
    );
    const b = await commit(
      "src/server.js",
      "export const server = 2;\n",
      "fix(api): keep the dash fix for old couriers",
    );
    await commit("src/server.js", "export const server = 3;\n", "feat: add health route");
    const c = await commit("src/worker.js", "export const w = 1;\n", "feat: worker");
    const d = await commit("src/worker.js", "export const w = 2;\n", 'Revert "feat: worker"');
    await commit("pnpm-lock.yaml", "lock\n", "fix: bump lockfile");
    await commit("pnpm-lock.yaml", "lock2\n", "fix: bump lockfile again");

    const r = await scanProject(nodeFs, dir, { sources: ["git"], git, now: new Date() });
    const titles = r.candidates.map((x) => x.title);
    expect(titles).toEqual(["Change hotspots", "Gotchas in src/server.js", "Gotchas in src/worker.js"]);

    const hot = r.candidates[0];
    expect(hot).toMatchObject({
      source: "git",
      type: "memory",
      kind: "fact",
      evidence: ["git-history:hotspots"],
    });
    expect(hot?.body).toMatch(/^- `src\/server\.js`: 4 commits\n- `src\/worker\.js`: 2 commits/);
    expect(hot?.body).not.toMatch(/pnpm-lock/);

    const server = r.candidates[1];
    expect(server).toMatchObject({
      type: "memory",
      kind: "gotcha",
      paths: ["src/server.js"],
      evidence: ["git-history:src/server.js"],
      tags: ["adopted"],
    });
    expect(server?.body).toMatch(new RegExp(`- ${b} fix\\(api\\): keep the dash fix for old couriers`));
    expect(server?.body).toMatch(new RegExp(`- ${a} fix: parse tracking codes with dashes`));
    expect(server?.summary).toBe(
      "2 fix or revert commits touched src/server.js; read them before changing it.",
    );
    expect(r.candidates[2]?.body).toMatch(new RegExp(`- ${d} Revert "feat: worker"`));
    expect(c).toBeTruthy();
  });

  it("skips quietly outside a git repository and respects --since", async () => {
    rmSync(join(dir, ".git"), { recursive: true, force: true });
    const r = await scanProject(nodeFs, dir, { sources: ["git"], git, now: new Date() });
    expect(r.candidates).toEqual([]);
    expect(r.skipped).toEqual([{ evidence: "git", reason: "not a git repository" }]);
  });
});

describe("adopt prs source (M4.3)", () => {
  const prs = [
    {
      number: 41,
      title: "Fold scans in a worker",
      body: `## Why\n\nReads got slow.\n\n${"Long description. ".repeat(40)}`,
      labels: [],
      url: "https://github.com/acme/parcel-hub/pull/41",
    },
    {
      number: 42,
      title: "Bump deps",
      body: "small",
      labels: [],
      url: "https://github.com/acme/parcel-hub/pull/42",
    },
    {
      number: 43,
      title: "Store timestamps in UTC",
      body: "Short but labelled.",
      labels: [{ name: "decision" }],
      url: "https://github.com/acme/parcel-hub/pull/43",
    },
  ];

  it("turns merged PRs with long descriptions or decision labels into decision drafts", async () => {
    const calls: string[][] = [];
    const gh = async (args: string[]) => {
      calls.push(args);
      return { code: 0, stdout: JSON.stringify(prs), stderr: "" };
    };
    const r = await scanProject(nodeFs, dir, { sources: ["prs"], git, gh, now: new Date() });
    expect(calls[0]?.slice(0, 4)).toEqual(["pr", "list", "--state", "merged"]);
    expect(r.candidates.map((c) => [c.title, c.status, c.evidence[0]])).toEqual([
      ["Fold scans in a worker", "accepted", "https://github.com/acme/parcel-hub/pull/41"],
      ["Store timestamps in UTC", "accepted", "https://github.com/acme/parcel-hub/pull/43"],
    ]);
    expect(r.candidates[0]?.body).toMatch(/^## Context\n\n## Why\n\nReads got slow\./);
    expect(r.candidates[0]?.body).toMatch(/## Decision\n\nMerged in #41: Fold scans in a worker\./);
  });

  it("reports a missing or failing gh instead of failing the scan", async () => {
    const gh = async () => ({ code: 1, stdout: "", stderr: "gh: not logged in" });
    const r = await scanProject(nodeFs, dir, { sources: ["prs"], git, gh, now: new Date() });
    expect(r.candidates).toEqual([]);
    expect(r.skipped).toEqual([{ evidence: "prs", reason: "gh failed: gh: not logged in" }]);
    const none = await scanProject(nodeFs, dir, { sources: ["prs"], git, now: new Date() });
    expect(none.skipped).toEqual([{ evidence: "prs", reason: "gh is not available" }]);
  });
});
