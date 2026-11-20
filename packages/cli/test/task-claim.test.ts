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
