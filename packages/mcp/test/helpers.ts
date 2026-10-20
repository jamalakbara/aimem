import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Git } from "@aimem/core";
import { nodeFs } from "@aimem/core";
import { createAimemServer, type McpDeps } from "@aimem/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

export const FIXTURES = fileURLToPath(new URL("../../../fixtures/projects/", import.meta.url));

/** A git that is always a repo and always succeeds; records calls. */
export function fakeGit(): Git & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async run(args) {
      calls.push(args);
      if (args[0] === "--version") return { code: 0, stdout: "git version 2.99.0\n", stderr: "" };
      if (args[0] === "rev-parse" && args.includes("--abbrev-ref"))
        return { code: 0, stdout: "main\n", stderr: "" };
      if (args[0] === "rev-parse") return { code: 0, stdout: "true\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

// biome-ignore lint/suspicious/noExplicitAny: tests read arbitrary structured fields
type Structured = any;

export interface Harness {
  client: Client;
  dir: string;
  git: ReturnType<typeof fakeGit>;
  call: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ structured: Structured; text: string; isError: boolean }>;
  close: () => Promise<void>;
}

/** An in-memory MCP client connected to a server over a temp copy of a fixture. */
export async function harness(
  fixture = "tiny",
  deps: Partial<McpDeps> = {},
  clientName = "claude-code",
): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "aimem-mcp-"));
  cpSync(join(FIXTURES, fixture), dir, { recursive: true });
  const git = fakeGit();
  let n = 0;
  const server = createAimemServer({
    fs: nodeFs,
    clock: { now: () => new Date("2026-10-12T00:00:00Z") },
    random: { bytes: (k) => Uint8Array.from({ length: k }, () => n++ % 256) },
    git,
    env: {},
    cwd: dir,
    loadEmbedder: async () => ({ available: false, reason: "no local model in tests" }),
    ...deps,
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: clientName, version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return {
    client,
    dir,
    git,
    async call(name, args = {}) {
      const r = await client.callTool({ name, arguments: args });
      const text = (r.content as { type: string; text: string }[]).map((c) => c.text).join("\n");
      return { structured: r.structuredContent, text, isError: Boolean(r.isError) };
    },
    async close() {
      await client.close();
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
