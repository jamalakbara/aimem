import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AUTO_HEARTBEAT_MINUTES,
  acquireClaim,
  acquireTaskClaim,
  cryptoRandom,
  ensureLiveBranch,
  execaGit,
  type Git,
  heartbeatSessionClaims,
  heartbeatTaskClaim,
  listLiveClaims,
  listUnsyncedClaims,
  loadProject,
  nodeFs,
  readLiveClaims,
  readLiveState,
  reconcileLocalClaims,
  releaseTaskClaim,
  saveLocalClaim,
} from "@aimem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  expect(await readLiveClaims(nb, false, deps)).toEqual({
    claims: [],
    warnings: [`Skipped invalid live claim entry claims/${task}.json.`],
  });
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
    expect(new Map(claims.map((claim) => ["task" in claim ? claim.task : claim.id, claim.session]))).toEqual(
      winners,
    );
    expect(await sh(remote, "rev-list", "--count", live)).toBe("6");
  },
);

describe("path-only claims and overlap warnings", () => {
  const pathOwner = { holder: "agent:test", session: "paths" };
  const peer = { holder: "human:fixture", session: "peer" };

  it("claims, lists, extends and releases a path-only claim", async () => {
    const a = await loadProject(nodeFs, first);
    const b = await loadProject(nodeFs, second);
    await acquireTaskClaim(a, task, owner, at(0));
    const created = await acquireClaim(
      a,
      undefined,
      { ...pathOwner, paths: ["src/api/**"], note: "Ad hoc." },
      at(0),
    );
    expect(created.claim).toMatchObject({
      holder: "agent:test",
      session: "paths",
      paths: ["src/api/**"],
      note: "Ad hoc.",
    });
    const id = (created.claim as { id: string }).id;
    expect(id).toMatch(/^clm-[0-9a-hjkmnp-tv-z]{8}$/);
    expect(created.claim).not.toHaveProperty("task");
    expect(await sh(remote, "log", "-1", "--format=%s", live)).toBe("aimem: claim paths");
    const listed = await listLiveClaims(b, false, at(1));
    expect(listed.map((claim) => ("task" in claim ? claim.task : claim.id))).toEqual([
      `acme-ledger:${task}`,
      id,
    ]);
    expect(await heartbeatTaskClaim(b, id, pathOwner, at(1))).toMatchObject({
      id,
      heartbeat: at(1).clock.now().toISOString(),
    });
    expect(await acquireClaim(b, id, pathOwner, at(1))).toMatchObject({ claim: { id } });
    await expect(releaseTaskClaim(b, id, peer, at(1))).rejects.toMatchObject({ code: "CLAIM_CONFLICT" });
    expect(await releaseTaskClaim(b, id, pathOwner, at(1))).toBe(true);
    expect(await listLiveClaims(b, false, at(1))).toHaveLength(1);
  });

  it("rejects missing input and unknown path-only IDs", async () => {
    const nb = await loadProject(nodeFs, first);
    await expect(acquireClaim(nb, undefined, pathOwner, deps)).rejects.toMatchObject({ code: "USAGE" });
    await expect(acquireClaim(nb, undefined, { ...pathOwner, paths: ["../x"] }, deps)).rejects.toMatchObject({
      code: "USAGE",
    });
    await expect(
      acquireClaim(nb, undefined, { ...pathOwner, paths: ["src"], steal: true }, deps),
    ).rejects.toMatchObject({
      code: "USAGE",
    });
    await expect(acquireClaim(nb, "clm-00000000", pathOwner, deps)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("keeps abandoned paths when a path-only claim is taken over", async () => {
    const nb = await loadProject(nodeFs, first);
    const { claim } = await acquireClaim(
      nb,
      undefined,
      { ...pathOwner, paths: ["db/**"], ttlMinutes: 1 },
      at(0),
    );
    const id = (claim as { id: string }).id;
    const taken = await acquireClaim(nb, id, { ...peer, steal: true }, at(6));
    expect(taken.claim).toMatchObject({ id, holder: peer.holder, paths: ["db/**"] });
    expect(await sh(remote, "log", "-1", "--format=%B", live)).toContain("Aimem-Previous-Holder: agent:test");
  });

  it("warns about overlapping active claims by other holders without blocking", async () => {
    const a = await loadProject(nodeFs, first);
    const b = await loadProject(nodeFs, second);
    const held = await acquireClaim(a, undefined, { ...pathOwner, paths: ["src/api/**"] }, at(0));
    const heldId = (held.claim as { id: string }).id;
    const expiring = await acquireClaim(
      a,
      undefined,
      { ...pathOwner, session: "short", paths: ["docs/**"], ttlMinutes: 1 },
      at(0),
    );
    expect(expiring.overlaps).toEqual([]);

    const overlapping = await acquireClaim(
      b,
      task,
      { ...peer, paths: ["src/api/routes.ts", "src/web/**"] },
      at(2),
    );
    expect(overlapping.overlaps).toEqual([{ ref: heldId, holder: "agent:test", paths: ["src/api/**"] }]);
    expect(overlapping.warnings).toEqual([`Paths overlap ${heldId} held by agent:test (src/api/**).`]);
    expect(overlapping.claim).toMatchObject({ task: `acme-ledger:${task}`, holder: peer.holder });

    const disjoint = await acquireClaim(
      b,
      other,
      { ...peer, session: "v2", paths: ["src/api-v2/**", "docs/guide.md"] },
      at(2),
    );
    expect(disjoint.overlaps).toEqual([]);
    const sameHolder = await acquireClaim(
      a,
      undefined,
      { ...pathOwner, session: "again", paths: ["src/api/**"] },
      at(2),
    );
    expect(sameHolder.overlaps).toEqual([expect.objectContaining({ ref: `acme-ledger:${task}` })]);
    expect(sameHolder.overlaps.map((overlap) => overlap.holder)).not.toContain("agent:test");
  });

  it("warns when the task is done or cancelled in this checkout", async () => {
    const file = join(first, ".aimem/tasks/tsk-4d5e6f7g-write-rounding-tests-for-fee-splits.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("status: open", "status: done"));
    const result = await acquireClaim(await loadProject(nodeFs, first), other, owner, deps);
    expect(result.warnings).toEqual([`acme-ledger:${other} is done in this checkout.`]);
  });
});

describe("Git requirements for claims", () => {
  it("requires Git 2.31 before any remote work", async () => {
    const calls: string[][] = [];
    const old: Git = {
      async run(args, cwd, options) {
        calls.push(args);
        if (args[0] === "--version") return { code: 0, stdout: "git version 2.30.9\n", stderr: "" };
        return git.run(args, cwd, options);
      },
    };
    await expect(claim(first, task, "one", old)).rejects.toMatchObject({
      code: "SYNC_FAILED",
      message: "Git claims require Git 2.31 or newer. Found 2.30.",
    });
    expect(calls.some((args) => args.includes("fetch") || args.includes("push"))).toBe(false);
  });

  it("requires exactly one origin push URL", async () => {
    await sh(first, "remote", "set-url", "--add", "--push", "origin", remote);
    await sh(first, "remote", "set-url", "--add", "--push", "origin", join(root, "mirror.git"));
    await expect(claim(first, task, "one")).rejects.toMatchObject({
      code: "SYNC_FAILED",
      message: "Git claims require an origin remote with one push URL.",
    });
  });
});

describe("shared claims", () => {
  const ana = { holder: "agent:ana", session: "ana" };
  const ben = { holder: "human:ben", session: "ben" };
  const share = (who: typeof ana) => ({ ...who, share: true });
  const stored = async () => JSON.parse(await sh(remote, "show", `${live}:claims/${task}.json`));

  it("creates, joins, extends per participant and leaves a shared claim", async () => {
    const a = await loadProject(nodeFs, first);
    const b = await loadProject(nodeFs, second);
    const created = await acquireClaim(a, task, { ...share(ana), ttlMinutes: 10 }, at(0));
    expect(created.claim).toMatchObject({
      holder: ana.holder,
      session: ana.session,
      shared: true,
      participants: [
        { ...ana, joined: at(0).clock.now().toISOString(), heartbeat: at(0).clock.now().toISOString() },
      ],
    });
    const joined = await acquireClaim(b, task, share(ben), at(1));
    expect(joined.session).toBe("ben");
    expect(joined.claim.participants?.map((p) => p.holder)).toEqual([ana.holder, ben.holder]);
    expect(joined.claim).toMatchObject({ holder: ana.holder, heartbeat: at(1).clock.now().toISOString() });
    expect(await sh(remote, "log", "-1", "--format=%s", live)).toBe("aimem: join shared task claim");
    const tip = await sh(remote, "rev-parse", live);
    expect((await acquireClaim(b, task, share(ben), at(2))).claim).toEqual(joined.claim);
    expect(await sh(remote, "rev-parse", live)).toBe(tip);

    const beat = await heartbeatTaskClaim(a, task, ana, at(3));
    expect(beat.participants).toEqual([
      expect.objectContaining({ ...ana, heartbeat: at(3).clock.now().toISOString() }),
      expect.objectContaining({ ...ben, heartbeat: at(1).clock.now().toISOString() }),
    ]);
    expect(beat.heartbeat).toBe(at(3).clock.now().toISOString());

    expect(await releaseTaskClaim(a, task, ana, at(4))).toBe(true);
    expect(await stored()).toMatchObject({ holder: ben.holder, session: "ben", participants: [ben] });
    expect(await sh(remote, "log", "-1", "--format=%s", live)).toBe("aimem: leave shared task claim");
    expect(await releaseTaskClaim(a, task, ana, at(4))).toBe(false);
  });

  it("rejects mixing shared and exclusive claims and enforces the participant limit", async () => {
    const nb = await loadProject(nodeFs, first);
    await acquireTaskClaim(nb, other, ana, deps);
    await expect(acquireClaim(nb, other, share(ben), deps)).rejects.toMatchObject({ code: "CLAIM_CONFLICT" });
    await acquireClaim(nb, task, share(ana), deps);
    await expect(acquireClaim(nb, task, ben, deps)).rejects.toMatchObject({
      code: "CLAIM_CONFLICT",
      message: expect.stringContaining("Use --share to join"),
    });
    for (let i = 1; i < 8; i++)
      await acquireClaim(nb, task, share({ holder: "agent:ana", session: `s${i}` }), deps);
    expect((await stored()).participants).toHaveLength(8);
    await expect(acquireClaim(nb, task, share(ben), deps)).rejects.toMatchObject({
      code: "CLAIM_CONFLICT",
      message: expect.stringContaining("8 participants"),
    });
    await expect(acquireClaim(nb, undefined, { ...share(ana), paths: ["src"] }, deps)).rejects.toMatchObject({
      code: "USAGE",
    });
  });

  it("stays active while any participant is active and records every holder on takeover", async () => {
    const a = await loadProject(nodeFs, first);
    const b = await loadProject(nodeFs, second);
    await acquireClaim(a, task, { ...share(ana), ttlMinutes: 10 }, at(0));
    await acquireClaim(b, task, share(ben), at(5));
    await expect(heartbeatTaskClaim(a, task, ana, at(10))).rejects.toMatchObject({ code: "CLAIM_CONFLICT" });
    const outsider = { holder: "agent:carol", session: "carol" };
    expect((await listLiveClaims(b, false, at(12)))[0]).toMatchObject({ expired: false });
    await expect(acquireClaim(b, task, { ...outsider, steal: true }, at(12))).rejects.toMatchObject({
      code: "CLAIM_CONFLICT",
    });
    // A late joiner replaces the expired participant instead of counting it.
    const rejoined = await acquireClaim(b, task, share(outsider), at(12));
    expect(rejoined.claim.participants?.map((p) => p.holder)).toEqual([ben.holder, outsider.holder]);
    expect(rejoined.claim.holder).toBe(ben.holder);
    await expect(acquireClaim(b, task, { ...ana, steal: true }, at(26.99))).rejects.toMatchObject({
      code: "CLAIM_CONFLICT",
    });
    const taken = await acquireClaim(b, task, { ...ana, steal: true }, at(27));
    expect(taken.claim).not.toHaveProperty("shared");
    const message = await sh(remote, "log", "-1", "--format=%B", live);
    expect(message).toContain("Aimem-Previous-Holder: human:ben");
    expect(message).toContain("Aimem-Previous-Holder: agent:carol");
  });

  /** The leader pushes first; the follower pushes from the tip it read before, so it must retry. */
  function orderedPushes(): { leader: Git; follower: Git } {
    let followerReady!: () => void;
    let leaderDone!: () => void;
    const ready = new Promise<void>((resolve) => {
      followerReady = resolve;
    });
    const done = new Promise<void>((resolve) => {
      leaderDone = resolve;
    });
    let leaderPushed = false;
    let followerWaited = false;
    return {
      leader: {
        async run(args, cwd, options) {
          if (!args.includes("push") || leaderPushed) return git.run(args, cwd, options);
          leaderPushed = true;
          await ready;
          const result = await git.run(args, cwd, options);
          leaderDone();
          return result;
        },
      },
      follower: {
        async run(args, cwd, options) {
          if (args.includes("push") && !followerWaited) {
            followerWaited = true;
            followerReady();
            await done;
          }
          return git.run(args, cwd, options);
        },
      },
    };
  }

  it.each(["join", "release"] as const)(
    "keeps both outcomes when a join races a release (%s first)",
    async (leader) => {
      const a = await loadProject(nodeFs, first);
      const b = await loadProject(nodeFs, second);
      await acquireClaim(a, task, share(ana), deps);
      await acquireClaim(a, task, share({ holder: "agent:dan", session: "dan" }), deps);
      const order = orderedPushes();
      const [joinGit, releaseGit] =
        leader === "join" ? [order.leader, order.follower] : [order.follower, order.leader];
      const [joined, released] = await Promise.all([
        acquireClaim(b, task, share(ben), { ...deps, git: joinGit }),
        releaseTaskClaim(a, task, ana, { ...deps, git: releaseGit }),
      ]);
      expect(joined.claim.shared).toBe(true);
      expect(released).toBe(true);
      expect((await stored()).participants.map((p: { holder: string }) => p.holder).sort()).toEqual([
        "agent:dan",
        "human:ben",
      ]);
    },
  );

  it("keeps a participant heartbeat when another session joins first", async () => {
    const a = await loadProject(nodeFs, first);
    const b = await loadProject(nodeFs, second);
    await acquireClaim(a, task, share(ana), at(0));
    const order = orderedPushes();
    const [, beat] = await Promise.all([
      acquireClaim(b, task, share(ben), { ...at(1), git: order.leader }),
      heartbeatTaskClaim(a, task, ana, { ...at(1), git: order.follower }),
    ]);
    expect(beat.participants?.map((p) => p.holder)).toEqual([ana.holder, ben.holder]);
    expect((await stored()).participants[0].heartbeat).toBe(at(1).clock.now().toISOString());
  });

  it("still rejects a stale release after a takeover of the shared claim", async () => {
    const a = await loadProject(nodeFs, first);
    const b = await loadProject(nodeFs, second);
    await acquireClaim(a, task, { ...share(ana), ttlMinutes: 1 }, at(0));
    const order = orderedPushes();
    const [taken, released] = await Promise.allSettled([
      acquireClaim(b, task, { ...ben, steal: true }, { ...at(6), git: order.leader }),
      releaseTaskClaim(a, task, ana, { ...at(6), git: order.follower }),
    ]);
    expect(taken.status).toBe("fulfilled");
    expect(released).toMatchObject({ status: "rejected", reason: { code: "CLAIM_CONFLICT" } });
    expect(await stored()).toMatchObject({ holder: ben.holder, session: "ben" });
  });

  it("rejects a shared entry whose holder does not match its first participant", async () => {
    await sh(second, "checkout", "-q", "--detach", "origin/aimem-live");
    await nodeFs.mkdir(join(second, "claims"));
    const time = clock.now().toISOString();
    const bad = {
      task: `acme-ledger:${task}`,
      holder: "agent:other",
      session: "x",
      started: time,
      heartbeat: time,
      ttl_minutes: 60,
      shared: true,
      participants: [{ ...ana, joined: time, heartbeat: time }],
    };
    writeFileSync(join(second, `claims/${task}.json`), JSON.stringify(bad));
    await sh(second, "add", "claims");
    await sh(second, "commit", "-qm", "bad shared fixture");
    await sh(second, "push", "-q", "origin", `HEAD:${live}`);
    await expect(
      acquireClaim(await loadProject(nodeFs, first), task, share(ben), deps),
    ).rejects.toMatchObject({
      code: "SYNC_FAILED",
    });
  });
});

describe("unsynced local claims (scenario 5)", () => {
  const local = { holder: "agent:test", session: "local" };
  const offline = async () => sh(first, "remote", "set-url", "origin", join(root, "missing.git"));
  const online = async () => sh(first, "remote", "set-url", "origin", remote);
  const gitState = async () => [
    await sh(first, "rev-parse", "HEAD"),
    await sh(first, "status", "--porcelain", "--untracked-files=no"),
    await sh(first, "ls-files", "--stage"),
  ];

  it("fails without --local, saves an unsynced claim, and syncs it when the remote returns", async () => {
    const nb = await loadProject(nodeFs, first);
    const before = await gitState();
    await offline();
    await expect(acquireClaim(nb, task, local, at(0))).rejects.toMatchObject({ code: "SYNC_FAILED" });
    const saved = await saveLocalClaim(nb, task, { ...local, paths: ["src/**"] }, at(0));
    expect(saved.claim).toMatchObject({ task: `acme-ledger:${task}`, unsynced: true, paths: ["src/**"] });
    expect(saved.warnings.at(-1)).toContain("Saved an unsynced local claim");
    expect((await saveLocalClaim(nb, task, local, at(1))).claim.started).toBe(saved.claim.started);
    await expect(saveLocalClaim(nb, task, { ...local, session: "other" }, at(1))).rejects.toMatchObject({
      code: "CLAIM_CONFLICT",
    });
    expect((await listUnsyncedClaims(nb, deps)).claims).toHaveLength(1);
    expect(await reconcileLocalClaims(nb, at(2))).toEqual([]);
    expect((await listUnsyncedClaims(nb, deps)).claims).toHaveLength(1);

    await online();
    expect(await reconcileLocalClaims(nb, at(3))).toEqual([
      `Synced the unsynced claim for acme-ledger:${task}.`,
    ]);
    expect((await listUnsyncedClaims(nb, deps)).claims).toEqual([]);
    expect(JSON.parse(await sh(remote, "show", `${live}:claims/${task}.json`))).toMatchObject({
      holder: local.holder,
      session: "local",
      started: at(0).clock.now().toISOString(),
      heartbeat: at(3).clock.now().toISOString(),
      paths: ["src/**"],
    });
    expect(await gitState()).toEqual(before);
  });

  it("drops an unsynced claim that lost to an earlier live claim or expired offline", async () => {
    const a = await loadProject(nodeFs, first);
    const b = await loadProject(nodeFs, second);
    await offline();
    await saveLocalClaim(a, task, local, at(0));
    await saveLocalClaim(a, other, { ...local, ttlMinutes: 1 }, at(0));
    await acquireTaskClaim(b, task, nextOwner, at(1));
    await online();
    const warnings = await reconcileLocalClaims(a, at(2));
    expect(warnings).toEqual([
      `Dropped the unsynced claim for acme-ledger:${task}: the live claim is held by human:fixture since ${at(1).clock.now().toISOString()}.`,
      `Dropped the unsynced claim for acme-ledger:${other}: it expired before it could sync.`,
    ]);
    expect((await listUnsyncedClaims(a, deps)).claims).toEqual([]);
    expect(JSON.parse(await sh(remote, "show", `${live}:claims/${task}.json`))).toMatchObject(nextOwner);
  });

  it("syncs an unsynced path-only claim under its local ID", async () => {
    const nb = await loadProject(nodeFs, first);
    await offline();
    const saved = await saveLocalClaim(nb, undefined, { ...local, paths: ["docs/**"] }, at(0));
    const id = (saved.claim as { id: string }).id;
    await expect(saveLocalClaim(nb, task, { ...local, steal: true }, deps)).rejects.toMatchObject({
      code: "USAGE",
    });
    await online();
    expect(await reconcileLocalClaims(nb, at(1))).toEqual([`Synced the unsynced claim for ${id}.`]);
    expect(JSON.parse(await sh(remote, "show", `${live}:claims/${id}.json`))).toMatchObject({
      id,
      paths: ["docs/**"],
      started: at(0).clock.now().toISOString(),
    });
  });
});

describe("live state for briefings and status (M3.5a)", () => {
  const me = { holder: "agent:test", session: "me" };

  it("reports on, skipped and unavailable without throwing", async () => {
    const nb = await loadProject(nodeFs, first);
    await acquireTaskClaim(nb, task, me, at(0));
    const on = await readLiveState(nb, at(1));
    expect(on.status).toBe("on");
    expect(on.claims.map((c) => ("task" in c ? c.task : c.id))).toEqual([`acme-ledger:${task}`]);
    const calls: string[][] = [];
    const counting: Git = {
      run: (args, cwd, options) => {
        calls.push(args);
        return git.run(args, cwd, options);
      },
    };
    expect(await readLiveState(nb, { ...at(1), git: counting }, { skip: true })).toEqual({
      status: "skipped",
      reason: "--no-live",
      claims: [],
    });
    expect(calls).toEqual([]);
    await sh(first, "remote", "set-url", "origin", join(root, "missing.git"));
    await saveLocalClaim(nb, other, me, at(1));
    const down = await readLiveState(nb, at(2));
    expect(down).toMatchObject({ status: "unavailable", reason: expect.stringContaining("aimem-live") });
    expect(down.claims).toEqual([expect.objectContaining({ unsynced: true, task: `acme-ledger:${other}` })]);
  });

  it("extends only this session's active claims after 20 minutes", async () => {
    const nb = await loadProject(nodeFs, first);
    await acquireTaskClaim(nb, task, me, at(0));
    await acquireTaskClaim(nb, other, { holder: "human:fixture", session: "them" }, at(0));
    const tip = await sh(remote, "rev-parse", live);
    const early = await heartbeatSessionClaims(nb, await readLiveState(nb, at(19.99)), me, at(19.99));
    expect(early).toEqual({ extended: [], warnings: [] });
    expect(
      await heartbeatSessionClaims(nb, await readLiveState(nb, at(25)), { holder: me.holder }, at(25)),
    ).toEqual({
      extended: [],
      warnings: [],
    });
    expect(await sh(remote, "rev-parse", live)).toBe(tip);
    const due = await heartbeatSessionClaims(
      nb,
      await readLiveState(nb, at(AUTO_HEARTBEAT_MINUTES)),
      me,
      at(20),
    );
    expect(due.extended).toEqual([`acme-ledger:${task}`]);
    const stored = JSON.parse(await sh(remote, "show", `${live}:claims/${task}.json`));
    expect(stored.heartbeat).toBe(at(20).clock.now().toISOString());
    expect(JSON.parse(await sh(remote, "show", `${live}:claims/${other}.json`)).heartbeat).toBe(
      at(0).clock.now().toISOString(),
    );
    const expired = await heartbeatSessionClaims(nb, await readLiveState(nb, at(500)), me, at(500));
    expect(expired.extended).toEqual([]);
  });

  it("copies the task's paths into a claim without --paths", async () => {
    const nb = await loadProject(nodeFs, first);
    expect((await acquireTaskClaim(nb, other, me, deps)).paths).toEqual(["src/ledger/rounding.ts"]);
    expect((await acquireTaskClaim(nb, task, { ...me, paths: ["docs/**"] }, deps)).paths).toEqual([
      "docs/**",
    ]);
  });

  it("explains a missing session, the same holder's other session and an exclusive claim", async () => {
    const nb = await loadProject(nodeFs, first);
    await acquireTaskClaim(nb, task, me, deps);
    await expect(heartbeatTaskClaim(nb, task, { holder: me.holder }, deps)).rejects.toMatchObject({
      code: "USAGE",
      message: expect.stringContaining("Pass --session <id> or set AIMEM_SESSION"),
    });
    await expect(acquireTaskClaim(nb, task, { ...me, session: "other" }, deps)).rejects.toMatchObject({
      code: "CLAIM_CONFLICT",
      message: expect.stringContaining("You already hold"),
    });
    await expect(
      acquireClaim(nb, task, { holder: "human:fixture", session: "x", share: true }, deps),
    ).rejects.toMatchObject({
      code: "CLAIM_CONFLICT",
      message: expect.stringContaining("claimed exclusively by agent:test"),
    });
  });
});
