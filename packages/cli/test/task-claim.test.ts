import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureLiveBranch, execaGit } from "@aimem/core";
import type { CliDeps } from "aimem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cli, FIXTURES, fakeGit } from "./helpers.js";

const git = execaGit({ GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" });
const task = "tsk-3c4d5e6f";
const other = "tsk-4d5e6f7g";
let root: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aimem-cli-claim-"));
  dir = join(root, "notebook");
  cpSync(join(FIXTURES, "tiny"), dir, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function team(): void {
  const config = join(dir, ".aimem/project.yaml");
  writeFileSync(
    config,
    readFileSync(config, "utf8").replace("mode: solo", "mode: team").replace("sync: none", "sync: git"),
  );
}

function claim(args: string[], deps: Partial<CliDeps> = {}, json = true) {
  return cli(["task", "claim", ...args, ...(json ? ["--json"] : []), "--dir", dir], deps);
}

async function sh(cwd: string, ...args: string[]): Promise<void> {
  const result = await git.run(args, cwd);
  if (result.code !== 0) throw new Error(result.stderr);
}

async function setupOrigin(): Promise<void> {
  const remote = join(root, "remote.git");
  await sh(root, "init", "--bare", "-q", remote);
  await sh(dir, "init", "-q");
  await sh(dir, "config", "user.name", "Fixture");
  await sh(dir, "config", "user.email", "fixture@example.invalid");
  await sh(dir, "remote", "add", "origin", remote);
  await ensureLiveBranch(git, dir);
  team();
}

it("returns a claim and reports conflicts by holder and session", async () => {
  await setupOrigin();
  const env = { AIMEM_SESSION: "from-env", AIMEM_AUTHOR: "agent:fixture" };
  const first = await claim(
    [task, "--session", "from-flag", "--ttl", "45m", "--paths", "db/**,src/**", "--note", "Pair later."],
    { git, env },
  );
  expect(first.code).toBe(0);
  const time = "2026-10-12T00:00:00.000Z";
  expect(first.json).toEqual({
    ok: true,
    command: "task claim",
    data: {
      claim: {
        task: `acme-ledger:${task}`,
        holder: "agent:fixture",
        session: "from-flag",
        started: time,
        heartbeat: time,
        ttl_minutes: 45,
        paths: ["db/**", "src/**"],
        note: "Pair later.",
      },
      overlaps: [],
    },
    warnings: [],
  });
  const duplicate = await claim([`acme-ledger:${task}`, "--session", "from-flag"], { git, env });
  expect(duplicate.json.data).toEqual(first.json.data);
  const conflict = await claim([task], { git, env });
  expect(conflict.code).toBe(3);
  expect(conflict.json).toMatchObject({
    ok: false,
    error: { code: "CLAIM_CONFLICT", details: { holder: "agent:fixture", since: time } },
  });
  const fromEnv = await claim([other], { git, env }, false);
  expect(fromEnv.code).toBe(0);
  expect(fromEnv.stdout).toContain("from-env");
  const defaultTtl = await claim([other], { git, env });
  expect(defaultTtl.json.data.claim.ttl_minutes).toBe(180);
});

it("generates an opaque session and uses the configured TTL", async () => {
  await setupOrigin();
  const config = join(dir, ".aimem/project.yaml");
  writeFileSync(config, `${readFileSync(config, "utf8").trimEnd()}\nclaims:\n  ttl_minutes: 35\n`);
  const result = await claim([task, "--author", "agent:fixture"], { git });
  expect(result.code).toBe(0);
  expect(result.json.data.claim).toMatchObject({
    session: expect.stringMatching(/^[0-9a-f]{32}$/),
    ttl_minutes: 35,
  });
});

describe("local claim validation", () => {
  it.each([
    { args: [task, "--offline"], code: "USAGE" },
    { args: ["mem-3c4d5e6f"], code: "USAGE" },
    { args: ["bad-ref"], code: "USAGE" },
    { args: ["foreign:tsk-3c4d5e6f"], code: "NOT_FOUND" },
    { args: ["tsk-00000000"], code: "NOT_FOUND" },
    { args: [task, "--session", "has spaces"], code: "USAGE" },
    { args: [task, "--paths", ","], code: "USAGE" },
    { args: [task, "--ttl", "0m"], code: "USAGE" },
    { args: [task, "--ttl", "9999999999999999m"], code: "USAGE" },
    { args: [task, "--note", "password=fixture-example-value"], code: "SECRET_DETECTED" },
  ])("fails with $code for $args before any remote work", async ({ args, code }) => {
    team();
    const runner = fakeGit();
    const result = await claim(args, { git: runner, env: { AIMEM_AUTHOR: "agent:fixture" } });
    expect(result.json.error.code).toBe(code);
    expect(result.stdout).not.toContain("fixture-example-value");
    expect(runner.calls).toEqual([]);
  });

  it("rejects a solo notebook before any Git calls", async () => {
    const runner = fakeGit();
    const result = await claim([task], { git: runner, env: { AIMEM_AUTHOR: "agent:fixture" } });
    expect(result.code).toBe(2);
    expect(result.json.error.code).toBe("USAGE");
    expect(runner.calls).toEqual([]);
  });
});

it("lists claims in task order and exposes heartbeat, expiry, takeover and release contracts", async () => {
  await setupOrigin();
  const env = { AIMEM_AUTHOR: "agent:fixture", AIMEM_SESSION: "owner" };
  const command = (args: string[], minutes = 0, json = true) =>
    cli([...args, "--dir", dir, ...(json ? ["--json"] : [])], {
      git,
      env,
      clock: { now: () => new Date(Date.parse("2026-10-12T00:00:00Z") + minutes * 60_000) },
    });
  expect((await command(["live"])).json.data).toEqual({ claims: [] });
  expect((await command(["task", "claim", other])).code).toBe(0);
  expect((await command(["task", "claim", task, "--ttl", "1m"])).code).toBe(0);
  const beat = await command(["task", "heartbeat", task], 0.5);
  expect(beat.json).toMatchObject({
    ok: true,
    command: "task heartbeat",
    data: { claim: { heartbeat: "2026-10-12T00:00:30.000Z", session: "owner" } },
  });
  const views = (await command(["live"], 2)).json.data.claims;
  expect(views.map((entry: { task: string }) => entry.task)).toEqual(
    [task, other].map((id) => `acme-ledger:${id}`),
  );
  expect(views[0]).toMatchObject({ expired: true, expiresAt: "2026-10-12T00:01:30.000Z" });
  expect((await command(["live"], 2, false)).stdout).toContain("possibly abandoned");
  const takeover = await command(["task", "claim", task, "--steal", "--session", "next"], 7);
  expect(takeover.json.data.claim.session).toBe("next");
  expect((await command(["task", "release", task], 7)).code).toBe(3);
  const release = ["task", "release", task, "--session", "next"];
  expect((await command(release, 7)).json).toMatchObject({
    command: "task release",
    data: { released: true },
  });
  expect((await command(release, 7)).json.data).toEqual({ released: false });
});

it.each([
  { args: ["live", "--offline"] },
  { args: ["task", "heartbeat", task] },
  { args: ["task", "release", task, "--offline", "--session", "fixture"] },
])("rejects invalid lifecycle invocation $args before remote work", async ({ args }) => {
  team();
  const runner = fakeGit();
  const result = await cli([...args, "--dir", dir, "--json"], {
    git: runner,
    env: { AIMEM_AUTHOR: "agent:fixture" },
  });
  expect(result.code).toBe(2);
  expect(result.json.error.code).toBe("USAGE");
  expect(runner.calls).toEqual([]);
});

it("claims paths without a task, warns about overlaps and lists path-only claims", async () => {
  await setupOrigin();
  const as = (author: string, session: string) => ({
    git,
    env: { AIMEM_AUTHOR: author, AIMEM_SESSION: session },
  });
  const held = await claim(["--paths", "src/api/**", "--note", "Hotfix."], as("agent:fixture", "one"));
  expect(held.code).toBe(0);
  const id = held.json.data.claim.id as string;
  expect(id).toMatch(/^clm-[0-9a-hjkmnp-tv-z]{8}$/);
  expect(held.json.data).toEqual({
    claim: {
      id,
      holder: "agent:fixture",
      session: "one",
      started: "2026-10-12T00:00:00.000Z",
      heartbeat: "2026-10-12T00:00:00.000Z",
      ttl_minutes: 180,
      paths: ["src/api/**"],
      note: "Hotfix.",
    },
    overlaps: [],
  });

  const overlapping = await claim([task, "--paths", "src/api/routes.ts"], as("human:peer", "two"));
  expect(overlapping.code).toBe(0);
  expect(overlapping.json.data.overlaps).toEqual([
    { ref: id, holder: "agent:fixture", paths: ["src/api/**"] },
  ]);
  expect(overlapping.json.warnings).toEqual([`Paths overlap ${id} held by agent:fixture (src/api/**).`]);
  const human = await claim([other, "--paths", "src/api"], as("human:peer", "three"), false);
  expect(human.code).toBe(0);
  expect(human.stderr).toContain(`warning: Paths overlap ${id} held by agent:fixture`);

  const live = await cli(["live", "--dir", dir], as("agent:fixture", "one"));
  expect(live.stdout.trim().split("\n").at(-1)).toContain(`${id} (src/api/**)  agent:fixture  active`);
  const beat = await cli(["task", "heartbeat", id, "--dir", dir, "--json"], as("agent:fixture", "one"));
  expect(beat.json.data.claim.id).toBe(id);
  const release = await cli(["task", "release", id, "--dir", dir, "--json"], as("agent:fixture", "one"));
  expect(release.json.data).toEqual({ released: true });
});

it.each([
  { name: "no ref or paths", args: [] },
  { name: "a parent path", args: ["--paths", "../outside"] },
  { name: "an absolute path", args: [task, "--paths", "/etc/**"] },
  { name: "a path-only takeover without an ID", args: ["--paths", "src", "--steal"] },
])("rejects $name before any Git calls", async ({ args }) => {
  team();
  const runner = fakeGit();
  const result = await claim(args, { git: runner, env: { AIMEM_AUTHOR: "agent:fixture" } });
  expect(result.code).toBe(2);
  expect(result.json.error.code).toBe("USAGE");
  expect(runner.calls).toEqual([]);
});

it("creates and joins a shared claim and shows its participants", async () => {
  await setupOrigin();
  const as = (author: string, session: string) => ({
    git,
    env: { AIMEM_AUTHOR: author, AIMEM_SESSION: session },
  });
  const created = await claim([task, "--share"], as("agent:ana", "ana"));
  expect(created.code).toBe(0);
  expect(created.json.data.claim).toMatchObject({ shared: true, participants: [{ holder: "agent:ana" }] });
  const joined = await claim([task, "--share"], as("human:ben", "ben"), false);
  expect(joined.code).toBe(0);
  expect(joined.stdout).toContain("(session ben). Participants: agent:ana, human:ben.");
  const exclusive = await claim([task], as("agent:carol", "carol"));
  expect(exclusive.code).toBe(3);
  expect(exclusive.json.error.message).toContain("Use --share to join");
  const live = await cli(["live", "--dir", dir], as("agent:ana", "ana"));
  expect(live.stdout).toContain("agent:ana, human:ben  active  shared");
  const leave = await cli(["task", "release", task, "--dir", dir, "--json"], as("human:ben", "ben"));
  expect(leave.json.data).toEqual({ released: true });
  const again = await cli(["task", "release", task, "--dir", dir, "--json"], as("human:ben", "ben"));
  expect(again.json.data).toEqual({ released: false });
});

it("rejects --share without a task ref before any Git calls", async () => {
  team();
  const runner = fakeGit();
  const result = await claim(["--paths", "src", "--share"], {
    git: runner,
    env: { AIMEM_AUTHOR: "agent:fixture" },
  });
  expect(result.code).toBe(2);
  expect(result.json.error.code).toBe("USAGE");
  expect(runner.calls).toEqual([]);
});
