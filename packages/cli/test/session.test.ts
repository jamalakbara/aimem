import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cli, FIXTURES, fakeGit } from "./helpers.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aimem-session-"));
  cpSync(join(FIXTURES, "tiny"), dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const agent = { env: { AIMEM_AUTHOR: "agent:claude-code" } };
const HANDOFF = [
  "handoff",
  "--task",
  "tsk-3c4d5e6f",
  "--done",
  "Dropped the float column",
  "--not-done",
  "Rounding tests",
  "--next",
  "Write fee-split tests",
];

describe("handoff", () => {
  it("writes the handoff (contract) with the current branch", async () => {
    const r = await cli([...HANDOFF, "--json", "--dir", dir], agent);
    expect(r.code).toBe(0);
    await expect(`${JSON.stringify(r.json, null, 2)}\n`).toMatchFileSnapshot(
      "__snapshots__/contracts/handoff.json",
    );
    expect(readFileSync(join(dir, r.json.data.file), "utf8")).toContain("branch: main\n");
  });

  it("--from-file supplies sections; flags override the file", async () => {
    writeFileSync(
      join(dir, "notes.md"),
      "## Done\nFrom file\n\n## Not done\nnothing\n\n## Next\nfile next\n\n## Blocked\nAPI key\n",
    );
    const r = await cli(
      ["handoff", "--from-file", join(dir, "notes.md"), "--next", "flag next", "--json", "--dir", dir],
      agent,
    );
    const text = readFileSync(join(dir, r.json.data.file), "utf8");
    expect(text).toContain("## Done\nFrom file\n");
    expect(text).toContain("## Next\nflag next\n");
    expect(text).toContain("## Blocked\nAPI key\n");
  });

  it("missing sections → INVALID_RECORD, exit 2", async () => {
    const r = await cli(["handoff", "--done", "x", "--json", "--dir", dir], agent);
    expect(r.code).toBe(2);
    expect(r.json.error.code).toBe("INVALID_RECORD");
  });

  it("--release-claims is accepted and says claims arrive in M3", async () => {
    const r = await cli([...HANDOFF, "--release-claims", "--json", "--dir", dir], agent);
    expect(r.json.data.claimsReleased).toBe(0);
    expect(r.json.warnings.join(" ")).toMatch(/M3/);
  });

  it("--commit commits even for a human author", async () => {
    const git = fakeGit();
    const r = await cli([...HANDOFF, "--commit", "--json", "--dir", dir], {
      env: { AIMEM_AUTHOR: "human:akbar" },
      git,
    });
    expect(r.json.data.git).toBe("committed");
    expect(git.calls.find((c) => c[0] === "commit")?.[3]).toBe(
      `aimem: handoff ${r.json.data.ref} Dropped the float column`,
    );
  });
});

describe("status", () => {
  it("summarises the notebook (contract)", async () => {
    const r = await cli(["status", "--json", "--dir", join(FIXTURES, "medium")]);
    expect(r.code).toBe(0);
    await expect(`${JSON.stringify(r.json, null, 2)}\n`).toMatchFileSnapshot(
      "__snapshots__/contracts/status.json",
    );
  });

  it("prints a readable overview", async () => {
    const r = await cli(["status", "--dir", join(FIXTURES, "medium")]);
    expect(r.stdout).toContain("127 records");
    expect(r.stdout).toContain("Open p0/p1 tasks");
    expect(r.stdout).toContain("Last handoff: hnd-yqdkq1wv");
  });
});

describe("doctor", () => {
  it("reports each check (contract) and exits 0", async () => {
    const r = await cli(["doctor", "--json", "--dir", dir], { env: {}, git: fakeGit("Dana Example") });
    expect(r.code).toBe(0);
    await expect(`${JSON.stringify(r.json, null, 2)}\n`).toMatchFileSnapshot(
      "__snapshots__/contracts/doctor.json",
    );
  });

  it("warns about problems but still exits 0", async () => {
    const noGit = { calls: [], run: async () => ({ code: 127, stdout: "", stderr: "not found" }) };
    const r = await cli(["doctor", "--json", "--dir", join(FIXTURES, "messy")], { env: {}, git: noGit });
    expect(r.code).toBe(0);
    const byName = Object.fromEntries(
      r.json.data.checks.map((c: { name: string; status: string }) => [c.name, c.status]),
    );
    expect(byName).toMatchObject({ git: "warn", notebook: "warn" });
  });

  it("detects the aimem block in AGENTS.md", async () => {
    writeFileSync(join(dir, "AGENTS.md"), "# Agents\n<!-- aimem:begin v1 -->\n...\n<!-- aimem:end -->\n");
    const r = await cli(["doctor", "--json", "--dir", dir], { env: {}, git: fakeGit() });
    const adapters = r.json.data.checks.find((c: { name: string }) => c.name === "adapters");
    expect(adapters.status).toBe("ok");
    expect(adapters.detail).toContain("AGENTS.md");
  });

  it("says plainly when record text leaves the machine for remote embeddings", async () => {
    const { writeFileSync: w, readFileSync: r } = await import("node:fs");
    const file = join(dir, ".aimem/project.yaml");
    w(
      file,
      `${r(file, "utf8")}retrieval:\n  embeddings:\n    provider: openai-compatible\n    endpoint: https://embed.example.com/v1\n    model: m\n    allow_remote: true\n`,
    );
    const res = await cli(["doctor", "--json", "--dir", dir], { env: {}, git: fakeGit() });
    const out = res.json.data.checks.find((c: { name: string }) => c.name === "outbound data");
    expect(out.status).toBe("warn");
    expect(out.detail).toMatch(/record text is sent to embed\.example\.com/);
  });
});
