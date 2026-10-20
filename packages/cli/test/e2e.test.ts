import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * M1 acceptance (docs/13): in a fresh repo, init → add decision → add memory → handoff → validate,
 * run as separate processes against the built binary (vitest global setup builds it).
 */
const BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  AIMEM_AUTHOR: "agent:e2e",
};
let repo: string;

function run(cmd: string, args: string[], input?: string) {
  const r = spawnSync(cmd, args, { cwd: repo, env, input, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
function aimem(args: string[], input?: string) {
  const r = run("node", [BIN, ...args, "--json"], input);
  let json: { ok: boolean; data: Record<string, unknown> } | undefined;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    json = undefined;
  }
  return { ...r, json };
}
const git = (...args: string[]) => run("git", args).stdout.trim();

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "aimem-e2e-"));
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Dana Example");
  git("config", "user.email", "dana@example.com");
  git("config", "commit.gpgsign", "false");
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe("M1 end-to-end with the built binary", () => {
  it("init → decide → remember → handoff → validate, each agent write in its own commit", () => {
    const init = aimem(["init", "--no-intake"]);
    expect(init.code, init.stderr).toBe(0);
    git("add", "-A");
    git("commit", "-q", "-m", "chore: add aimem notebook");

    const dec = aimem([
      "decide",
      "--title",
      "Use SQLite for local dev",
      "--summary",
      "Local development uses SQLite; production stays on Postgres.",
      "--status",
      "accepted",
      "--body",
      "## Context\nFast setup.\n\n## Decision\nSQLite locally.\n\n## Consequences\nAvoid Postgres-only SQL in dev paths.",
    ]);
    expect(dec.code, dec.stderr).toBe(0);
    expect(dec.json?.data.git).toBe("committed");

    const mem = aimem(
      [
        "remember",
        "--title",
        "Migrations must be reversible",
        "--summary",
        "Every migration needs a down step; CI runs up, down, up.",
        "--kind",
        "constraint",
        "--body",
        "-",
      ],
      "Enforced by the migration check in CI.\n",
    );
    expect(mem.code, mem.stderr).toBe(0);

    const hnd = aimem([
      "handoff",
      "--done",
      "Recorded the dev database decision",
      "--not-done",
      "Migration check script",
      "--next",
      "Write the CI migration check",
    ]);
    expect(hnd.code, hnd.stderr).toBe(0);
    expect(hnd.json?.data.git).toBe("committed");

    const v = aimem(["validate", "--strict"]);
    expect(v.code, v.stdout).toBe(0);
    expect(v.json?.data).toMatchObject({ errors: 0, warnings: 0 });

    const status = aimem(["status"]);
    expect(status.json?.data).toMatchObject({ total: 3, lastHandoff: { ref: hnd.json?.data.ref } });
    const doctor = aimem(["doctor"]);
    expect(doctor.code).toBe(0);

    expect(git("log", "--format=%s").split("\n")).toEqual([
      `aimem: handoff ${hnd.json?.data.ref} Recorded the dev database decision`,
      `aimem: add ${mem.json?.data.ref} Migrations must be reversible`,
      `aimem: add ${dec.json?.data.ref} Use SQLite for local dev`,
      "chore: add aimem notebook",
    ]);
    for (const sha of git("log", "--format=%h", "-3").split("\n")) {
      for (const f of git("show", "--name-only", "--format=", sha).split("\n"))
        expect(f.startsWith(".aimem/")).toBe(true);
    }
    expect(git("status", "--porcelain")).toBe("");
    expect(readFileSync(join(repo, ".aimem/INDEX.md"), "utf8")).toContain(String(hnd.json?.data.ref));
  });

  it("reports errors with stable exit codes from the real process", () => {
    expect(aimem(["show", "mem-zzzzzzzz"]).code).toBe(1);
    expect(aimem(["lst"]).code).toBe(2);
    const dup = aimem([
      "remember",
      "--title",
      "Migrations must be reversible",
      "--summary",
      "Same thing again.",
      "--body",
      "x",
    ]);
    expect(dup.code).toBe(3);
  });
});
