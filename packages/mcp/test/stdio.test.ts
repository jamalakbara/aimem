import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** End to end: the SDK's stdio client launches the built `aimem serve mcp` (vitest global setup builds it). */
const BIN = new URL("../../cli/dist/bin.js", import.meta.url).pathname;
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  AIMEM_HOME: "/nonexistent-aimem-home",
} as Record<string, string>;
let repo: string;
const git = (...args: string[]) => spawnSync("git", args, { cwd: repo, env, encoding: "utf8" }).stdout.trim();

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "aimem-mcp-e2e-"));
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Dana Example");
  git("config", "user.email", "dana@example.com");
  git("config", "commit.gpgsign", "false");
  spawnSync("node", [BIN, "init", "--no-intake"], { cwd: repo, env });
  git("add", "-A");
  git("commit", "-q", "-m", "chore: add aimem notebook");
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe("aimem serve mcp over stdio", () => {
  it("serves context, add and handoff to a real MCP client; agent writes are committed", async () => {
    const client = new Client({ name: "e2e-agent", version: "1.0.0" });
    await client.connect(
      new StdioClientTransport({ command: "node", args: [BIN, "serve", "mcp"], cwd: repo, env }),
    );
    try {
      const ctx = await client.callTool({ name: "aimem_context", arguments: { task: "set up the ledger" } });
      expect(ctx.isError).toBeFalsy();
      expect((ctx.content as { text: string }[])[0]?.text).toMatch(/^# aimem briefing/);
      const add = await client.callTool({
        name: "aimem_add",
        arguments: {
          type: "decision",
          title: "Use SQLite locally",
          summary: "Local development uses SQLite; production stays on Postgres.",
          body: "## Context\nx\n\n## Decision\ny\n\n## Consequences\nz",
          status: "accepted",
        },
      });
      const ref = (add.structuredContent as { data: { ref: string; git: string } }).data;
      expect(ref.git).toBe("committed");
      const hnd = await client.callTool({
        name: "aimem_handoff",
        arguments: {
          done: "Chose SQLite for local dev",
          not_done: "Migrations",
          next: "Write the first migration",
        },
      });
      expect(hnd.isError).toBeFalsy();
      expect(git("log", "--format=%s%n%b", "-2")).toContain("Aimem-Author: agent:e2e-agent");
      const hndRef = (hnd.structuredContent as { data: { ref: string } }).data.ref;
      expect(readFileSync(join(repo, ".aimem/INDEX.md"), "utf8")).toContain(hndRef);
      expect(readFileSync(join(repo, `.aimem/decisions/${ref.ref}-use-sqlite-locally.md`), "utf8")).toContain(
        "author: agent:e2e-agent\n",
      );
      expect(git("status", "--porcelain")).toBe("");
    } finally {
      await client.close();
    }
  });

  it("exits cleanly (code 0, no warnings) when the client closes stdin", () => {
    const r = spawnSync("node", [BIN, "serve", "mcp"], {
      cwd: repo,
      env,
      input: "",
      encoding: "utf8",
      timeout: 20000,
    });
    expect(r.stderr).not.toMatch(/unsettled top-level await/);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
});
