import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireTaskClaim,
  cryptoRandom,
  ensureLiveBranch,
  execaGit,
  type Git,
  heartbeatTaskClaim,
  listLiveClaims,
  loadProject,
  nodeFs,
  releaseTaskClaim,
} from "@aimem/core";
import { afterEach, beforeEach, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";

const git = execaGit({
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_DATE: "2026-10-13T08:00:00Z",
  GIT_COMMITTER_DATE: "2026-10-13T08:00:00Z",
});
const live = "refs/heads/aimem-live";
const task = "tsk-3c4d5e6f";
const other = "tsk-4d5e6f7g";
const stressTasks = [task, other, "tsk-00000001", "tsk-00000002", "tsk-00000003"];
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
  for (const id of stressTasks.slice(2)) {
    const body = readFileSync(
      join(first, ".aimem/tasks/tsk-3c4d5e6f-add-currency-column-to-ledger-entries.md"),
      "utf8",
    );
    writeFileSync(join(first, `.aimem/tasks/${id}-stress.md`), body.replace(`id: ${task}`, `id: ${id}`));
  }
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
  const nb = await loadProject(nodeFs, first);
  await expect(listLiveClaims(nb, false, deps)).rejects.toMatchObject({ code: "SYNC_FAILED" });
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

const owner = { holder: "agent:test", session: "one" };
const nextOwner = { holder: "human:fixture", session: "two" };
const challenger = { ...nextOwner, steal: true };
const at = (minutes: number, runner = git) => ({
  ...deps,
  git: runner,
  clock: { now: () => new Date(clock.now().getTime() + minutes * 60_000) },
});

it("shows nominal expiry and permits takeover only when the skew allowance elapses", async () => {
  const a = await loadProject(nodeFs, first);
  const b = await loadProject(nodeFs, second);
  const original = await acquireTaskClaim(a, task, { ...owner, ttlMinutes: 10 }, at(0));
  const heartbeat = await heartbeatTaskClaim(a, task, owner, at(4));
  expect(heartbeat).toEqual({ ...original, heartbeat: at(4).clock.now().toISOString() });
  const tip = await sh(remote, "rev-parse", live);
  expect(await heartbeatTaskClaim(a, task, owner, at(2))).toEqual(heartbeat);
  expect(await sh(remote, "rev-parse", live)).toBe(tip);
  expect(await listLiveClaims(b, false, at(13.99))).toEqual([
    { ...heartbeat, expiresAt: at(14).clock.now().toISOString(), expired: false },
  ]);
  await expect(acquireTaskClaim(b, task, challenger, at(13.99))).rejects.toMatchObject({
    code: "CLAIM_CONFLICT",
  });
  expect((await listLiveClaims(b, false, at(14)))[0]?.expired).toBe(true);
  await expect(heartbeatTaskClaim(a, task, owner, at(14))).rejects.toMatchObject({ code: "CLAIM_CONFLICT" });
  await expect(acquireTaskClaim(a, task, owner, at(14))).rejects.toMatchObject({ code: "CLAIM_CONFLICT" });
  await expect(acquireTaskClaim(b, task, challenger, at(18.99))).rejects.toMatchObject({
    code: "CLAIM_CONFLICT",
  });
  const replaced = await acquireTaskClaim(b, task, challenger, at(19));
  expect(replaced).toMatchObject({ holder: challenger.holder, session: challenger.session });
  expect(await acquireTaskClaim(b, task, challenger, at(20))).toEqual(replaced);
  expect(await sh(remote, "log", "-1", "--format=%B", live)).toContain("Aimem-Previous-Holder: agent:test");
});

it("lets only the owning session release, including after the durable task file is removed", async () => {
  const nb = await loadProject(nodeFs, first);
  expect(await releaseTaskClaim(nb, task, owner, at(0))).toBe(false);
  await expect(heartbeatTaskClaim(nb, task, owner, at(0))).rejects.toMatchObject({ code: "NOT_FOUND" });
  await acquireTaskClaim(nb, task, { ...owner, ttlMinutes: 1 }, at(0));
  const otherSession = { ...owner, session: "other" };
  await expect(heartbeatTaskClaim(nb, task, otherSession, at(0))).rejects.toMatchObject({
    code: "CLAIM_CONFLICT",
  });
  await expect(releaseTaskClaim(nb, task, otherSession, at(0))).rejects.toMatchObject({
    code: "CLAIM_CONFLICT",
  });
  const file = ".aimem/tasks/tsk-3c4d5e6f-add-currency-column-to-ledger-entries.md";
  rmSync(join(first, file));
  const staged = await sh(first, "ls-files", "--stage");
  expect(await releaseTaskClaim(nb, task, owner, at(20))).toBe(true);
  expect(await releaseTaskClaim(nb, task, owner, at(20))).toBe(false);
  expect(await listLiveClaims(nb, false, at(20))).toEqual([]);
  expect(await sh(first, "ls-files", "--stage")).toBe(staged);
  expect(await sh(first, "status", "--short", "--", file)).toContain(file);
});

it("allows only one takeover with two eligible sessions", async () => {
  const a = await loadProject(nodeFs, first);
  const b = await loadProject(nodeFs, second);
  await acquireTaskClaim(a, task, { ...owner, ttlMinutes: 1 }, at(0));
  const runner = racePushes();
  const results = await Promise.allSettled([
    acquireTaskClaim(a, task, { ...challenger, session: "first" }, at(6, runner)),
    acquireTaskClaim(b, task, challenger, at(6, runner)),
  ]);
  const success = results.filter((result) => result.status === "fulfilled");
  const failures = results.filter((result) => result.status === "rejected");
  expect(success).toHaveLength(1);
  expect(failures).toHaveLength(1);
  expect(failures[0]?.reason).toMatchObject({ code: "CLAIM_CONFLICT" });
  expect(await sh(remote, "rev-list", "--count", live)).toBe("3");
});

it.each(["heartbeat", "release"] as const)("keeps a takeover safe from a stale %s", async (operation) => {
  const a = await loadProject(nodeFs, first);
  const b = await loadProject(nodeFs, second);
  await acquireTaskClaim(a, task, { ...owner, ttlMinutes: 10 }, at(0));
  const runner: Git = {
    async run(args, cwd, options) {
      if (args.includes("push")) await acquireTaskClaim(b, task, challenger, at(15));
      return git.run(args, cwd, options);
    },
  };
  const change = operation === "heartbeat" ? heartbeatTaskClaim : releaseTaskClaim;
  await expect(change(a, task, owner, at(1, runner))).rejects.toMatchObject({ code: "CLAIM_CONFLICT" });
  expect((await listLiveClaims(b, false, at(15)))[0]?.session).toBe(challenger.session);
});

it("detects removal and recreation with identical claim content during a release retry", async () => {
  const a = await loadProject(nodeFs, first);
  const b = await loadProject(nodeFs, second);
  const original = await acquireTaskClaim(a, task, owner, at(0));
  const runner: Git = {
    async run(args, cwd, options) {
      if (args.includes("push")) {
        await releaseTaskClaim(b, task, owner, at(0));
        expect(await acquireTaskClaim(b, task, owner, at(0))).toEqual(original);
      }
      return git.run(args, cwd, options);
    },
  };
  await expect(releaseTaskClaim(a, task, owner, at(1, runner))).rejects.toMatchObject({
    code: "CLAIM_CONFLICT",
  });
  expect((await listLiveClaims(b, false, at(1)))[0]).toMatchObject(original);
});

it("retries unrelated advances and confirms a later tip contains a heartbeat with a lost response", async () => {
  const a = await loadProject(nodeFs, first);
  const b = await loadProject(nodeFs, second);
  await acquireTaskClaim(a, task, owner, at(0));
  let pushes = 0;
  const runner: Git = {
    async run(args, cwd, options) {
      if (!args.includes("push")) return git.run(args, cwd, options);
      if (++pushes === 1) await acquireTaskClaim(b, other, nextOwner, at(0));
      const result = await git.run(args, cwd, options);
      if (result.code !== 0) return result;
      await releaseTaskClaim(b, other, challenger, at(1));
      return { ...result, code: 1, stderr: "lost fixture response" };
    },
  };
  expect(await heartbeatTaskClaim(a, task, owner, at(1, runner))).toMatchObject({
    heartbeat: at(1).clock.now().toISOString(),
  });
  expect(pushes).toBe(2);
});

it.skipIf(process.env.AIMEM_CLAIM_STRESS !== "1")(
  "20 clones contend for five tasks",
  { timeout: 240_000 },
  async () => {
    const clones = [first, second];
    for (let n = 2; n < 20; n++) {
      const dir = join(root, `clone-${n}`);
      await sh(root, "clone", "-q", remote, dir);
      await sh(dir, "config", "user.name", "Fixture");
      await sh(dir, "config", "user.email", "fixture@example.invalid");
      clones.push(dir);
    }
    const notebooks = await Promise.all(clones.map((dir) => loadProject(nodeFs, dir)));
    const winners = new Map<string, string>();
    for (const id of stressTasks) {
      const results = await Promise.allSettled(
        notebooks.map((nb, n) =>
          acquireTaskClaim(nb, id, { holder: "agent:stress", session: `worker-${n}` }, at(0)),
        ),
      );
      const success = results.filter((result) => result.status === "fulfilled");
      const conflicts = results.filter((result) => result.status === "rejected");
      expect(success).toHaveLength(1);
      expect(conflicts).toHaveLength(19);
      expect(conflicts.every((result) => result.reason.code === "CLAIM_CONFLICT")).toBe(true);
      const winner = success[0]?.value;
      if (!winner) throw new Error("Expected a winning claim");
      winners.set(winner.task, winner.session);
    }
    const claims = await listLiveClaims(await loadProject(nodeFs, first), false, at(0));
    expect(new Map(claims.map((claim) => [claim.task, claim.session]))).toEqual(winners);
    expect(await sh(remote, "rev-list", "--count", live)).toBe("6");
  },
);
