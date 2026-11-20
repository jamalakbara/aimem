import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireTaskClaim, ensureLiveBranch, execaGit, loadProject, nodeFs } from "@aimem/core";
import { claimToolsAvailable, createAimemServer } from "@aimem/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";

const git = execaGit({ GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" });
const task = "tsk-3c4d5e6f";
const other = "tsk-4d5e6f7g";
const clock = { now: () => new Date("2026-10-12T00:00:00Z") };
let root: string;
let dir: string;
let closers: (() => Promise<void>)[] = [];

async function sh(cwd: string, ...args: string[]): Promise<string> {
  const r = await git.run(args, cwd);
  if (r.code !== 0) throw new Error(r.stderr);
  return r.stdout;
}

// biome-ignore lint/suspicious/noExplicitAny: tests read arbitrary structured fields
async function connect(env: Record<string, string> = {}, clientName = "claude-code"): Promise<any> {
  const deps = {
    fs: nodeFs,
    clock,
    random: { bytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) },
    git,
    env,
    cwd: dir,
  };
  const server = createAimemServer(deps, { claimTools: await claimToolsAvailable(deps) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: clientName, version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  closers.push(async () => {
    await client.close();
    await server.close();
  });
  return {
    client,
    async call(name: string, args: Record<string, unknown> = {}) {
      const r = await client.callTool({ name, arguments: args });
      return r.structuredContent;
    },
  };
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "aimem-mcp-claims-"));
  dir = join(root, "notebook");
  cpSync(join(FIXTURES, "tiny"), dir, { recursive: true });
  await sh(root, "init", "--bare", "-q", join(root, "remote.git"));
  await sh(dir, "init", "-q");
  await sh(dir, "config", "user.name", "Fixture");
  await sh(dir, "config", "user.email", "fixture@example.invalid");
  await sh(dir, "remote", "add", "origin", join(root, "remote.git"));
  await ensureLiveBranch(git, dir);
  const config = join(dir, ".aimem/project.yaml");
  writeFileSync(
    config,
    readFileSync(config, "utf8").replace("mode: solo", "mode: team").replace("sync: none", "sync: git"),
  );
});

afterEach(async () => {
  for (const close of closers) await close();
  closers = [];
  rmSync(root, { recursive: true, force: true });
});

describe("MCP claim tools (05 §2, M3.5b)", () => {
  it("lists claim tools only for team notebooks with Git sync", async () => {
    const team = await connect();
    const names = (await team.client.listTools()).tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "aimem_task_claim",
        "aimem_task_heartbeat",
        "aimem_task_release",
        "aimem_live",
      ]),
    );
    expect(await claimToolsAvailable({ fs: nodeFs, cwd: join(FIXTURES, "tiny") })).toBe(false);
  });

  it("claims, conflicts, extends, lists and releases with one session per server", async () => {
    const agent = await connect({ AIMEM_AUTHOR: "agent:one" });
    const claimed = await agent.call("aimem_task_claim", { ref: task });
    expect(claimed).toMatchObject({
      ok: true,
      data: { claim: { task: `acme-ledger:${task}`, holder: "agent:one" }, overlaps: [] },
      warnings: [],
    });
    const session = claimed.data.claim.session;
    expect((await agent.call("aimem_task_claim", { ref: task })).data.claim.session).toBe(session);
    const rival = await connect({ AIMEM_AUTHOR: "agent:two" });
    const conflict = await rival.call("aimem_task_claim", { ref: task });
    expect(conflict.error).toMatchObject({ code: "CLAIM_CONFLICT", details: { holder: "agent:one" } });
    expect((await agent.call("aimem_task_heartbeat", { ref: task })).data.claim.session).toBe(session);
    const live = await rival.call("aimem_live");
    expect(live.data.claims).toEqual([
      expect.objectContaining({ task: `acme-ledger:${task}`, holder: "agent:one", expired: false }),
    ]);
    expect((await rival.call("aimem_task_release", { ref: task })).error.code).toBe("CLAIM_CONFLICT");
    expect((await agent.call("aimem_task_release", { ref: task })).data).toEqual({ released: true });
    expect((await agent.call("aimem_live")).data.claims).toEqual([]);
  });

  it("returns the same claim data as the CLI core", async () => {
    const agent = await connect({ AIMEM_AUTHOR: "agent:one", AIMEM_SESSION: "fixed" });
    const viaMcp = (await agent.call("aimem_task_claim", { ref: other, note: "pairing later" })).data.claim;
    const viaCore = await acquireTaskClaim(
      await loadProject(nodeFs, dir),
      other,
      { holder: "agent:one", session: "fixed" },
      { fs: nodeFs, clock, random: { bytes: (n) => new Uint8Array(n) }, git },
    );
    expect(viaMcp).toEqual(viaCore);
  });

  it("handoff writes the record, releases this session's claims and reports others", async () => {
    const agent = await connect({ AIMEM_AUTHOR: "agent:one" });
    const peer = await connect({ AIMEM_AUTHOR: "human:peer", AIMEM_SESSION: "peer" });
    await agent.call("aimem_task_claim", { ref: task });
    await agent.call("aimem_task_claim", { paths: ["docs/**"] });
    await peer.call("aimem_task_claim", { paths: ["db/migrations/0004.sql"] });
    const r = await agent.call("aimem_handoff", {
      done: "Migration written",
      not_done: "Backfill",
      next: "Run the backfill",
      task,
    });
    expect(r.ok).toBe(true);
    expect(r.data.ref).toMatch(/^hnd-/);
    expect(r.data.claimsReleased).toBe(2);
    expect(r.data.claims).toMatchObject({
      status: "on",
      checkedAt: "2026-10-12T00:00:00.000Z",
      kept: [],
      related: [{ holders: ["human:peer"], paths: ["db/migrations/0004.sql"] }],
    });
    expect(r.data.claims.released).toHaveLength(2);
    expect((await peer.call("aimem_live")).data.claims.map((c: { holder: string }) => c.holder)).toEqual([
      "human:peer",
    ]);
  });

  it("keeps the handoff when the remote is down and says the claims may still be active", async () => {
    const agent = await connect({ AIMEM_AUTHOR: "agent:one" });
    await agent.call("aimem_task_claim", { ref: task });
    await sh(dir, "remote", "set-url", "origin", join(root, "missing.git"));
    const r = await agent.call("aimem_handoff", { done: "x", not_done: "y", next: "z" });
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ claimsReleased: 0, claims: { status: "unavailable" } });
    expect(r.warnings[0]).toContain("your claims may still be active");
  });
});
