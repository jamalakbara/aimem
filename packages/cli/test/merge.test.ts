import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execaGit } from "@aimem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cli, FIXTURES } from "./helpers.js";

const git = execaGit({ GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" });
let dir: string;
const env = { AIMEM_AUTHOR: "human:dana" };

async function sh(...args: string[]): Promise<{ code: number; stdout: string }> {
  // Hooks are disabled here so a globally installed aimem cannot run inside the test repository.
  return git.run(["-c", "core.hooksPath=/dev/null", ...args], dir);
}
async function ok(...args: string[]): Promise<string> {
  const r = await sh(...args);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stdout}`);
  return r.stdout;
}
const aimem = (args: string[]) => cli([...args, "--dir", dir], { git, env });

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "aimem-merge-"));
  cpSync(join(FIXTURES, "tiny"), dir, { recursive: true });
  await ok("init", "-q", "-b", "main");
  await ok("config", "user.name", "Dana Example");
  await ok("config", "user.email", "dana@example.invalid");
  await ok("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, ".gitattributes"), ".aimem/INDEX.md merge=ours\n");
  expect((await aimem(["index"])).code).toBe(0);
  await ok("add", "-A");
  await ok("commit", "-qm", "notebook");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Both branches write a handoff, so INDEX.md's recent-handoff list changes at the same place. */
async function twoBranches(): Promise<void> {
  for (const [branch, done] of [
    ["a", "Wrote the retry budget"],
    ["b", "Warmed the caches"],
  ] as const) {
    await ok("checkout", "-q", "main");
    await ok("checkout", "-qb", branch);
    // The test helper's random source restarts per call; give each branch its own IDs.
    const seed = branch === "a" ? 1 : 101;
    let n = seed;
    const random = { bytes: (k: number) => Uint8Array.from({ length: k }, () => n++ % 256) };
    const r = await cli(["handoff", "--done", done, "--not-done", "x", "--next", "y", "--dir", dir], {
      git,
      env,
      random,
    });
    expect(r.code).toBe(0);
    await ok("add", "-A");
    await ok("commit", "-qm", branch);
  }
}

describe("aimem hooks (07 §1 rule 5)", () => {
  it("installs idempotently, keeps existing hook content and uninstalls cleanly", async () => {
    const hooksDir = join(dir, ".git/hooks");
    writeFileSync(join(hooksDir, "post-merge"), "#!/bin/sh\necho custom\n");
    const first = await aimem(["hooks", "install", "--json"]);
    expect(first.json.data).toMatchObject({
      installed: ["post-merge", "post-checkout", "post-rewrite"],
      mergeDriver: true,
      attribute: true,
    });
    expect(first.json.data.changed).toEqual([
      "post-merge",
      "post-checkout",
      "post-rewrite",
      "git config merge.ours.driver",
    ]);
    const merged = readFileSync(join(hooksDir, "post-merge"), "utf8");
    expect(merged.startsWith("#!/bin/sh\necho custom\n")).toBe(true);
    expect(merged).toContain("aimem index --quiet");
    if (process.platform !== "win32")
      expect(statSync(join(hooksDir, "post-checkout")).mode & 0o111).not.toBe(0);
    expect((await aimem(["hooks", "install", "--json"])).json.data.changed).toEqual([]);
    expect(
      (await aimem(["doctor", "--json"])).json.data.checks.find(
        (c: { name: string }) => c.name === "index merge",
      ),
    ).toMatchObject({ status: "ok" });
    const removed = await aimem(["hooks", "uninstall", "--json"]);
    expect(removed.json.data.installed).toEqual([]);
    expect(readFileSync(join(hooksDir, "post-merge"), "utf8")).toBe("#!/bin/sh\necho custom\n");
    expect(existsSync(join(hooksDir, "post-checkout"))).toBe(false);
  });
});

describe("merge scenarios (12 §4)", () => {
  it("scenario 6: INDEX.md conflicts without the merge driver", async () => {
    await twoBranches();
    const merge = await sh("merge", "--no-edit", "a");
    expect(merge.code).not.toBe(0);
    expect((await ok("diff", "--name-only", "--diff-filter=U")).trim()).toBe(".aimem/INDEX.md");
  });

  it("scenario 6: with aimem hooks install, records merge cleanly and aimem index regenerates INDEX.md", async () => {
    expect((await aimem(["hooks", "install"])).code).toBe(0);
    await twoBranches();
    const merge = await sh("merge", "--no-edit", "a");
    expect(merge.code).toBe(0);
    const before = readFileSync(join(dir, ".aimem/INDEX.md"), "utf8");
    expect((await aimem(["index"])).code).toBe(0);
    const after = readFileSync(join(dir, ".aimem/INDEX.md"), "utf8");
    expect(after).not.toBe(before);
    const titles = (await aimem(["list", "handoff", "--json"])).json.data.records.map(
      (r: { title: string }) => r.title,
    );
    expect(titles.filter((t: string) => /retry budget|Warmed the caches/.test(t))).toHaveLength(2);
    expect((await aimem(["validate", "--strict"])).code).toBe(0);
  });

  it("scenario 7: a concurrent edit conflicts, and validate --fix restores the derived link", async () => {
    expect((await aimem(["hooks", "install"])).code).toBe(0);
    const old = "dec-1a2b3c4d";
    await ok("checkout", "-qb", "a");
    const replacement = await aimem([
      "decide",
      "--title",
      "Store money as minor units with currency",
      "--summary",
      "Replaces the integer cents decision.",
      "--body",
      "## Context\nx\n\n## Decision\nx\n\n## Consequences\nx\n\n## Alternatives\nx",
      "--json",
    ]);
    const next = replacement.json.data.ref as string;
    expect((await aimem(["supersede", old, "--by", next])).code).toBe(0);
    await ok("add", "-A");
    await ok("commit", "-qm", "a supersedes");
    await ok("checkout", "-q", "main");
    await ok("checkout", "-qb", "b");
    // Branch b changes the same status line that the supersede on branch a changed.
    expect((await aimem(["update", old, "--set", "status=deprecated"])).code).toBe(0);
    await ok("add", "-A");
    await ok("commit", "-qm", "b edits");
    const merge = await sh("merge", "--no-edit", "a");
    expect(merge.code).not.toBe(0);
    const conflicted = (await ok("diff", "--name-only", "--diff-filter=U")).trim().split("\n");
    expect(conflicted).toEqual([expect.stringContaining(`decisions/${old}-`)]);
    // A human keeps branch b's text, which drops the superseded_by link written on branch a.
    await ok("checkout", "--ours", "--", conflicted[0] as string);
    await ok("add", "-A");
    await ok("commit", "-qm", "merge a");
    const broken = await aimem(["validate", "--json"]);
    expect(broken.json.error.details.issues.map((i: { code: string }) => i.code)).toContain("V007");
    const fixed = await aimem(["validate", "--fix", "--json"]);
    expect(fixed.code).toBe(0);
    expect(fixed.json.data.fixed.map((f: { code: string }) => f.code)).toContain("V007");
    expect(readFileSync(join(dir, conflicted[0] as string), "utf8")).toContain(`superseded_by: ${next}`);
  });
});
