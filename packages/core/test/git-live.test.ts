import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureLiveBranch, execaGit, type Git } from "@aimem/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const git = execaGit({ GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" });
const liveRef = "refs/heads/aimem-live";
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aimem-live-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function sh(cwd: string, ...args: string[]): Promise<string> {
  const result = await git.run(args, cwd);
  if (result.code !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

it("initializes an empty orphan branch once when two clones race", async () => {
  const remote = join(root, "remote.git");
  const clones = [join(root, "one"), join(root, "two")] as const;
  await sh(root, "init", "--bare", "-q", "-b", "main", remote);
  for (const [i, clone] of clones.entries()) {
    mkdirSync(clone);
    await sh(clone, "clone", "-q", remote, ".");
    await sh(clone, "config", "user.name", `Fixture ${i}`);
    await sh(clone, "config", "user.email", "fixture@example.com");
  }
  await Promise.all(clones.map((clone) => ensureLiveBranch(git, clone)));
  const tip = await sh(remote, "rev-parse", liveRef);
  expect(await sh(remote, "rev-list", "--parents", liveRef)).toBe(tip);
  expect(await sh(remote, "ls-tree", "-r", liveRef)).toBe("");
  await ensureLiveBranch(git, clones[0]);
  expect(await sh(remote, "rev-parse", liveRef)).toBe(tip);
});

it.each([0, 2, 128])("checks the remote again after a failed push (lookup exit %s)", async (code) => {
  const oid = "a".repeat(40);
  const result = (code: number, stdout = "", stderr = "") => ({ code, stdout, stderr });
  const run = vi
    .fn<Git["run"]>()
    .mockResolvedValueOnce(result(2))
    .mockResolvedValueOnce(result(0, oid))
    .mockResolvedValueOnce(result(0, oid))
    .mockResolvedValueOnce(result(1, "", "private remote details"))
    .mockResolvedValueOnce(result(code, code === 0 ? `${oid}\t${liveRef}` : ""));
  const setup = ensureLiveBranch({ run }, root);
  if (code === 0) await expect(setup).resolves.toBeUndefined();
  else await expect(setup).rejects.toMatchObject({ code: "SYNC_FAILED" });
  expect(run.mock.calls[4]).toEqual(run.mock.calls[0]);
});
