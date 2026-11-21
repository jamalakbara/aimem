import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeFs } from "@aimem/core";
import { createAimemServer } from "@aimem/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, expect, it } from "vitest";
import { FIXTURES, fakeGit } from "./helpers.js";

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("MCP read tools see hub and sibling records with labels and framing (M3.6a)", async () => {
  root = mkdtempSync(join(tmpdir(), "aimem-mcp-multirepo-"));
  cpSync(join(FIXTURES, "multirepo"), root, { recursive: true });
  const server = createAimemServer({
    fs: nodeFs,
    clock: { now: () => new Date("2026-11-21T00:00:00Z") },
    random: { bytes: (n) => new Uint8Array(n) },
    git: fakeGit(),
    env: { AIMEM_HOME: join(root, "cache") },
    cwd: join(root, "backend"),
    loadEmbedder: async () => ({ available: false, reason: "no local model in tests" }),
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "claude-code", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      return {
        data: (r.structuredContent as { data: Record<string, unknown> }).data,
        text: (r.content as { text: string }[])[0]?.text ?? "",
      };
    };
    const got = await call("aimem_get", { ref: "acme-shop:dec-t1a73qsk" });
    expect(got.data).toMatchObject({ ref: "dec-t1a73qsk", notebook: "hub" });
    expect(got.text).toContain("<aimem-record");
    const hits = (await call("aimem_search", { query: "integer cents money", mode: "lexical" })).data
      .hits as { ref: string; notebook?: string }[];
    expect(hits[0]).toMatchObject({ ref: "dec-t1a73qsk", notebook: "hub" });
    const ctx = await call("aimem_context", { task: "money in the cart" });
    expect(ctx.text).toContain("> sources: local, hub, repo:frontend · missing: repo:infra");
  } finally {
    await client.close();
    await server.close();
  }
});
