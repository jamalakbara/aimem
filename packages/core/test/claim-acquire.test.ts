import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireTaskClaim,
  cryptoRandom,
  ensureLiveBranch,
  execaGit,
  type Git,
  loadProject,
  nodeFs,
} from "@aimem/core";
import { afterEach, beforeEach, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";

const git = execaGit({ GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" });
const live = "refs/heads/aimem-live";
const task = "tsk-3c4d5e6f";
const other = "tsk-4d5e6f7g";
const clock = { now: () => new Date("2026-10-13T08:00:00Z") };
const deps = { fs: nodeFs, clock, random: cryptoRandom, git };

let root: string;
let remote: string;
let first: string;
let second: string;

async function sh(cwd: string, ...args: string[]): Promise<string> {
  const result = await git.run(args, cwd);
  if (result.code !== 0) throw new Error(result.stderr);
  return result.stdout;
}

async function claim(cwd: string, ref: string, session: string, runner: Git = git, note?: string) {
  return acquireTaskClaim(
    await loadProject(nodeFs, cwd),
    ref,
    { holder: "agent:test", session, ...(note === undefined ? {} : { note }) },
    { ...deps, git: runner },
  );
}

function racePushes(): Git {
  let pushes = 0;
  let release!: () => void;
  const bothReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    async run(args, cwd, options) {
      if (args.includes("push") && ++pushes <= 2) {
        if (pushes === 2) release();
        await bothReady;
      }
      return git.run(args, cwd, options);
    },
  };
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "aimem-claim-"));
  remote = join(root, "remote.git");
  first = join(root, "first");
  second = join(root, "second");
  await sh(root, "init", "--bare", "-q", "-b", "main", remote);
  await sh(root, "clone", "-q", remote, first);
  await sh(first, "config", "user.name", "Fixture");
  await sh(first, "config", "user.email", "fixture@example.invalid");
  cpSync(join(FIXTURES, "tiny"), first, { recursive: true });
  const config = join(first, ".aimem/project.yaml");
  writeFileSync(
    config,
    readFileSync(config, "utf8").replace("mode: solo", "mode: team").replace("sync: none", "sync: git"),
  );
  await sh(first, "add", ".");
  await sh(first, "commit", "-qm", "fixture");
  await sh(first, "push", "-q", "origin", "main");
  await ensureLiveBranch(git, first);
  await sh(root, "clone", "-q", remote, second);
  await sh(second, "config", "user.name", "Fixture");
  await sh(second, "config", "user.email", "fixture@example.invalid");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

it("publishes a single claim when two clones with the same holder race", async () => {
  const runner = racePushes();
  const results = await Promise.allSettled([
    claim(first, task, "one", runner),
    claim(second, task, "two", runner),
  ]);
  const winner = results.find((result) => result.status === "fulfilled");
  const loser = results.find((result) => result.status === "rejected");
  expect(winner?.value.session).toMatch(/^(one|two)$/);
  expect(loser?.reason).toMatchObject({
    code: "CLAIM_CONFLICT",
    details: { holder: "agent:test", since: clock.now().toISOString() },
  });
  expect(JSON.parse(await sh(remote, "show", `${live}:claims/${task}.json`))).toEqual(winner?.value);
  expect(await sh(remote, "rev-list", "--count", live)).toBe("2");
});

it("reapplies a different claim after a race in one checkout without changing Git's normal state", async () => {
  writeFileSync(join(first, "staged.txt"), "staged");
  await sh(first, "add", "staged.txt");
  writeFileSync(join(first, "staged.txt"), "unstaged");
  const state = async () =>
    Promise.all([
      sh(first, "symbolic-ref", "HEAD"),
      sh(first, "rev-parse", "HEAD"),
      sh(first, "ls-files", "--stage"),
      sh(first, "for-each-ref", "--format=%(refname) %(objectname)", "refs/remotes", "refs/aimem"),
    ]);
  const before = await state();
  const fetchHead = join(first, ".git/FETCH_HEAD");
  writeFileSync(fetchHead, "unchanged");
  const runner = racePushes();
  await Promise.all([claim(first, task, "one", runner), claim(first, other, "two", runner)]);
  expect(await sh(remote, "ls-tree", "-r", "--name-only", live)).toBe(
    `claims/${task}.json\nclaims/${other}.json`,
  );
  expect(await sh(remote, "rev-list", "--count", live)).toBe("3");
  expect(await state()).toEqual(before);
  expect(readFileSync(join(first, "staged.txt"), "utf8")).toBe("unstaged");
  expect(readFileSync(fetchHead, "utf8")).toBe("unchanged");
  expect(await nodeFs.readdir(join(first, ".aimem/.cache"))).toEqual([]);
});

it("recovers a lost push response and returns the original claim on an identical-session retry", async () => {
  const runner: Git = {
    async run(args, cwd, options) {
      const result = await git.run(args, cwd, options);
      if (args.includes("push") && result.code === 0) return { ...result, code: 1, stderr: "lost response" };
      return result;
    },
  };
  const claimed = await claim(first, task, "one", runner, "Original.");
  const tip = await sh(remote, "rev-parse", live);
  expect(await claim(second, `acme-ledger:${task}`, "one", git, "Different.")).toEqual(claimed);
  expect(await sh(remote, "rev-parse", live)).toBe(tip);
});

it("does not recreate the live ref if it disappears before the push", async () => {
  const runner: Git = {
    async run(args, cwd, options) {
      if (args.includes("push")) await sh(remote, "update-ref", "-d", live);
      return git.run(args, cwd, options);
    },
  };
  await expect(claim(first, task, "one", runner)).rejects.toMatchObject({
    code: "SYNC_FAILED",
    message: expect.stringContaining("aimem init --upgrade --sync git"),
  });
  expect(await sh(remote, "for-each-ref", "--format=%(refname)", live)).toBe("");
});

it("reports an unavailable remote without exposing details", async () => {
  const missing = join(root, "missing-remote.git");
  await sh(first, "remote", "set-url", "origin", missing);
  await expect(claim(first, task, "one")).rejects.toMatchObject({
    code: "SYNC_FAILED",
    message: expect.not.stringContaining("missing-remote"),
  });
});

it("preserves a corrupt existing task entry", async () => {
  await sh(second, "checkout", "-q", "--detach", "origin/aimem-live");
  await nodeFs.mkdir(join(second, "claims"));
  writeFileSync(join(second, `claims/${task}.json`), "invalid");
  await sh(second, "add", "claims");
  await sh(second, "commit", "-qm", "corrupt fixture");
  await sh(second, "push", "-q", "origin", `HEAD:${live}`);
  const tip = await sh(remote, "rev-parse", live);
  await expect(claim(first, task, "one")).rejects.toMatchObject({ code: "SYNC_FAILED" });
  expect(await sh(remote, "rev-parse", live)).toBe(tip);
});

it("stops after three changing-tip push failures without exposing raw errors", async () => {
  await sh(second, "checkout", "-q", "--detach", "origin/aimem-live");
  let pushes = 0;
  const runner: Git = {
    async run(args, cwd, options) {
      if (args.includes("push")) {
        pushes++;
        await sh(second, "commit", "-q", "--allow-empty", "-m", `other change ${pushes}`);
        await sh(second, "push", "-q", "origin", `HEAD:${live}`);
        return { code: 1, stdout: "", stderr: "internal fixture details" };
      }
      return git.run(args, cwd, options);
    },
  };
  await expect(claim(first, task, "one", runner)).rejects.toMatchObject({
    code: "SYNC_FAILED",
    message: expect.not.stringContaining("internal fixture details"),
  });
  expect(pushes).toBe(3);
});
