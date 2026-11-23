import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cryptoRandom } from "@aimem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cli, FIXTURES, fakeGit } from "./helpers.js";

let dir: string;
const random = cryptoRandom;
const human = { AIMEM_AUTHOR: "human:dana" };
const agent = { AIMEM_AUTHOR: "agent:claude-code" };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aimem-cli-sheets-"));
  cpSync(join(FIXTURES, "tiny"), dir, { recursive: true });
  cpSync(join(FIXTURES, "../imports"), join(dir, "docs"), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const imp = (file: string, env = human, extra: Record<string, unknown> = {}, args: string[] = []) =>
  cli(["import", join(dir, "docs", file), ...args, "--json", "--dir", dir], { env, random, ...extra });
const tasks = () =>
  readdirSync(join(dir, ".aimem/tasks")).filter((f) =>
    readFileSync(join(dir, ".aimem/tasks", f), "utf8").includes("system: upload"),
  );

describe("aimem import <sheet>.csv (M4b.2)", () => {
  it("imports 20 tasks from a 21-row sheet, reports the bad row, and re-imports without duplicates", async () => {
    const a = await imp("tasks.csv");
    expect(a.code).toBe(0);
    expect(a.json.data).toMatchObject({ type: "task", created: 20, updated: 0, unchanged: 0 });
    expect(a.json.data.errors).toEqual([{ row: 7, reason: "priority 'p9' is not one of p0, p1, p2, p3" }]);
    expect(a.json.warnings).toContain("row 7: priority 'p9' is not one of p0, p1, p2, p3");
    expect(tasks()).toHaveLength(20);
    const b = await imp("tasks.csv");
    expect(b.json.data).toMatchObject({ created: 0, updated: 0, unchanged: 20 });
    const path = join(dir, "docs/tasks.csv");
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(
        "Retry webhooks for the parcel hub.",
        "Retry failed webhooks with backoff.",
      ),
    );
    const c = await imp("tasks.csv");
    expect(c.json.data).toMatchObject({ created: 0, updated: 1, unchanged: 19 });
    expect(tasks()).toHaveLength(20);
    expect((await cli(["validate", "--dir", dir], { env: human, random })).code).toBe(0);
  });

  it("--strict exits 1 when a row failed; good rows are still written", async () => {
    const r = await imp("tasks.csv", human, {}, ["--strict"]);
    expect(r.code).toBe(1);
    expect(tasks()).toHaveLength(20);
  });

  it("an agent import is one commit for the whole sheet", async () => {
    const git = fakeGit(undefined, "feature/sheet");
    const r = await imp("tasks.csv", agent, { git });
    expect(r.json.data.git).toBe("committed");
    expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(1);
  });

  it("imports testcases and incidents sheets", async () => {
    expect((await imp("testcases.csv")).json.data).toMatchObject({ type: "testcase", created: 1 });
    expect((await imp("incidents.csv")).json.data).toMatchObject({ type: "incident", created: 1 });
  });
});

describe("aimem templates (M4b.2)", () => {
  it("lists and exports sheet and document templates", async () => {
    const l = await cli(["templates", "list", "--json", "--dir", dir], { env: human });
    expect(l.json.data.templates.map((t: { name: string }) => t.name)).toEqual([
      "tasks",
      "testcases",
      "incidents",
      "decision",
      "runbook",
      "incident",
      "memory",
    ]);
    const csv = await cli(["templates", "export", "tasks", "--format", "csv", "--dir", dir], { env: human });
    expect(csv.stdout).toBe("title,summary,status,priority,assignee,roles,tags,due,paths,notes\n");
    const out = join(dir, "decision-template.md");
    const md = await cli(["templates", "export", "decision", "--format", "md", "--out", out, "--dir", dir], {
      env: human,
    });
    expect(md.code).toBe(0);
    const text = readFileSync(out, "utf8");
    expect(text).toMatch(/^# Decision title\n\nRoles: \nTags: \n\n## Summary\n/);
    expect(text).toMatch(/## Context\n[\s\S]*## Decision\n[\s\S]*## Consequences\n[\s\S]*## Alternatives\n/);
    const bad = await cli(["templates", "export", "tasks", "--format", "md", "--json", "--dir", dir], {
      env: human,
    });
    expect(bad.code).toBe(2);
    expect(bad.json.error.message).toMatch(/tasks is a sheet template: use --format csv/);
  });

  it("an exported document template imports back as its type", async () => {
    const out = join(dir, "docs/runbook-template.md");
    await cli(["templates", "export", "runbook", "--format", "md", "--out", out, "--dir", dir], {
      env: human,
    });
    const r = await cli(["import", out, "--json", "--dir", dir], { env: human, random });
    expect(r.json.data).toMatchObject({ type: "runbook", mode: "template" });
  });
});

describe("import safety follow-ups (QA #99 notes)", () => {
  it("an agent needs --allow-outside for files outside the project", async () => {
    const out = mkdtempSync(join(tmpdir(), "aimem-out-"));
    try {
      writeFileSync(join(out, "far.md"), "# Far away notes\n\nSomething.\n");
      const no = await cli(["import", join(out, "far.md"), "--json", "--dir", dir], { env: agent, random });
      expect(no.code).toBe(2);
      expect(no.json.error.message).toMatch(
        /is outside the project; an agent imports it only with --allow-outside/,
      );
      const yes = await cli(["import", join(out, "far.md"), "--allow-outside", "--json", "--dir", dir], {
        env: agent,
        random,
      });
      expect(yes.json.data.action).toBe("created");
      const human_ = await cli(["import", join(out, "far.md"), "--json", "--dir", dir], {
        env: human,
        random,
      });
      expect(human_.code).toBe(0);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("a lock left by a process that is gone does not block the next import", async () => {
    mkdirSync(join(dir, ".aimem/.cache"), { recursive: true });
    writeFileSync(join(dir, ".aimem/.cache/import.lock"), `999999999 ${new Date().toISOString()}`, {
      flag: "w",
    });
    const r = await imp("decision.md");
    expect(r.code).toBe(0);
    expect(existsSync(join(dir, ".aimem/.cache/import.lock"))).toBe(false);
  });

  it("validate warns about two records owned by the same source (V019)", async () => {
    const a = await imp("decision.md");
    const file = join(dir, a.json.data.file);
    const copy = readFileSync(file, "utf8").replace(a.json.data.ref, "dec-zzzzzzzz");
    writeFileSync(join(dir, ".aimem/decisions/dec-zzzzzzzz-copy.md"), copy);
    const v = await cli(["validate", "--json", "--dir", dir], { env: human, random });
    const v19 = v.json.data.issues.filter((i: { code: string }) => i.code === "V019");
    expect(v19).toHaveLength(2);
    expect(v19[0].message).toMatch(/same source as dec-/);
  });
});

describe("QA #100 review", () => {
  const big = (n: number) =>
    [
      "title,summary,status",
      ...Array.from(
        { length: n },
        (_, i) => `Item ${i} ${"abcdefghij"[i % 10]}${i * 7919},Summary ${i * 104729} text.,open`,
      ),
    ].join("\n");

  it("imports 1,000 rows quickly and re-imports them faster (finding 1)", async () => {
    writeFileSync(join(dir, "docs/big.csv"), big(1000));
    let t0 = performance.now();
    const a = await imp("big.csv");
    const first = performance.now() - t0;
    expect(a.json.data.created).toBe(1000);
    t0 = performance.now();
    const b = await imp("big.csv");
    const again = performance.now() - t0;
    expect(b.json.data.unchanged).toBe(1000);
    // 10 s on a developer machine; the shared Windows CI runner writes small files far slower (15 s, #101).
    expect(first).toBeLessThan(process.env.CI && process.platform !== "linux" ? 30_000 : 10_000);
    expect(again).toBeLessThan(first);
  }, 60_000);

  it("never takes the lock of a live import, however old (finding 2)", async () => {
    mkdirSync(join(dir, ".aimem/.cache"), { recursive: true });
    const lock = join(dir, ".aimem/.cache/import.lock");
    writeFileSync(lock, `${process.pid} 2026-01-01T00:00:00.000Z`);
    const old = new Date(Date.now() - 10 * 60_000);
    const { utimesSync } = await import("node:fs");
    utimesSync(lock, old, old);
    const r = await cli(["import", join(dir, "docs/decision.md"), "--json", "--dir", dir], {
      env: { ...human, AIMEM_IMPORT_LOCK_WAIT_MS: "200" },
      random,
    });
    expect(r.code).toBe(2);
    expect(r.json.error.message).toMatch(
      new RegExp(`another aimem import \\(pid ${process.pid}\\) is still running`),
    );
    expect(existsSync(lock)).toBe(true);
  }, 60_000);

  it("warns when a row's title changes, because row keys shift (finding 4)", async () => {
    writeFileSync(
      join(dir, "docs/abc.csv"),
      "title,summary,status\nAlpha,A one.,open\nBravo,B two.,open\nCharlie,C three.,open\n",
    );
    await imp("abc.csv");
    writeFileSync(
      join(dir, "docs/abc.csv"),
      "title,summary,status\nAlpha,A one.,open\nCharlie,C three.,open\n",
    );
    const r = await imp("abc.csv");
    expect(r.json.warnings.join("\n")).toMatch(
      /row 3 changed its title from "Bravo" to "Charlie"; row positions shift when rows are inserted or deleted, add a key column to keep them stable/,
    );
  });

  it("templates --out refuses an existing file without --force, and an agent outside the project (finding 5)", async () => {
    const out = join(dir, "existing.csv");
    writeFileSync(out, "precious");
    const no = await cli(["templates", "export", "tasks", "--out", out, "--json", "--dir", dir], {
      env: human,
    });
    expect(no.code).toBe(2);
    expect(no.json.error.message).toMatch(/already exists; pass --force to overwrite it/);
    expect(readFileSync(out, "utf8")).toBe("precious");
    const yes = await cli(["templates", "export", "tasks", "--out", out, "--force", "--json", "--dir", dir], {
      env: human,
    });
    expect(yes.code).toBe(0);
    const far = mkdtempSync(join(tmpdir(), "aimem-far-"));
    try {
      const a = await cli(
        ["templates", "export", "tasks", "--out", join(far, "t.csv"), "--json", "--dir", dir],
        { env: agent },
      );
      expect(a.code).toBe(2);
      expect(a.json.error.message).toMatch(
        /outside the project; an agent writes there only with --allow-outside/,
      );
    } finally {
      rmSync(far, { recursive: true, force: true });
    }
  });

  it("V019 says how to resolve it for imported records (finding 6)", async () => {
    const a = await imp("decision.md");
    const file = join(dir, a.json.data.file);
    writeFileSync(
      join(dir, ".aimem/decisions/dec-zzzzzzzz-copy.md"),
      readFileSync(file, "utf8").replace(a.json.data.ref, "dec-zzzzzzzz"),
    );
    const v = await cli(["validate", "--json", "--dir", dir], { env: human, random });
    const v19 = v.json.data.issues.find((i: { code: string }) => i.code === "V019");
    expect(v19.message).toMatch(
      /keep one: aimem detach the others, then aimem discard them \(or delete their files\)/,
    );
  });
});
