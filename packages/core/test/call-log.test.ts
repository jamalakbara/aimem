import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCallLog,
  createOpenAICompatibleProvider,
  loggedEmbeddingProvider,
  loggedLlmProvider,
  nodeFs,
  tokenUsage,
} from "@aimem/core";
import { afterEach, expect, it } from "vitest";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "aimem-log-"));
  dirs.push(dir);
  let ms = 0;
  const log = createCallLog(
    { dir },
    {
      fs: nodeFs,
      clock: {
        now: () => {
          ms += 10;
          return new Date(ms);
        },
      },
    },
  );
  const entries = async () =>
    (await readFile(join(dir, ".cache/calls.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
  return { log, entries };
}

it("logs generation metadata and usage without request, answer or extra fields", async () => {
  const { log, entries } = await setup();
  const p = loggedLlmProvider(
    {
      id: "claude-cli:test",
      generate: async () => ({ text: "private answer", usage: { inputTokens: 12, outputTokens: 3 } }),
    },
    log,
  );
  const result = await p.generate({ system: "private rules", prompt: "private records", refCount: 2 });
  expect(result.text).toBe("private answer");
  expect(await entries()).toEqual([
    {
      version: 1,
      time: "1970-01-01T00:00:00.010Z",
      kind: "llm",
      provider: "claude-cli",
      model: "test",
      latencyMs: 10,
      status: "ok",
      refCount: 2,
      usage: { inputTokens: 12, outputTokens: 3 },
    },
  ]);
});

it("logs document and query calls, retaining vectors and provider identity", async () => {
  const { log, entries } = await setup();
  const p = loggedEmbeddingProvider(
    { id: "local:test", dimensions: 2, maxInputTokens: 512, embed: async () => [[1, 0]] },
    log,
  );
  expect(await p.embed(["private chunk"], "document", { refCount: 1 })).toEqual([[1, 0]]);
  await p.embed(["private question"], "query");
  expect(p.id).toBe("local:test");
  expect((await entries()).map((e) => [e.kind, e.refCount, e.inputCount])).toEqual([
    ["embedding.document", 1, 1],
    ["embedding.query", 0, 1],
  ]);
  expect(JSON.stringify(await entries())).not.toContain("private");
});

it("records failure without error text and preserves the exact error", async () => {
  const { log, entries } = await setup();
  const error = new Error("private provider response");
  const p = loggedLlmProvider(
    {
      id: "claude-cli",
      generate: async () => {
        throw error;
      },
    },
    log,
  );
  await expect(p.generate({ system: "s", prompt: "p" })).rejects.toBe(error);
  expect(await entries()).toEqual([
    expect.objectContaining({ status: "error", model: null, refCount: null }),
  ]);
  expect(JSON.stringify(await entries())).not.toContain("private");
});

it("logging I/O failure does not fail successful calls or replace provider failures", async () => {
  const log = createCallLog(
    { dir: "/unused" },
    {
      fs: {
        ...nodeFs,
        mkdir: async () => {
          throw new Error("disk full");
        },
      },
      clock: { now: () => new Date(0) },
    },
  );
  const p = loggedLlmProvider({ id: "test", generate: async () => ({ text: "ok" }) }, log);
  await expect(p.generate({ system: "s", prompt: "p" })).resolves.toEqual({ text: "ok" });
  const error = new Error("original error");
  const failed = loggedLlmProvider(
    {
      id: "test",
      generate: async () => {
        throw error;
      },
    },
    log,
  );
  await expect(failed.generate({ system: "s", prompt: "p" })).rejects.toBe(error);
});

it("concurrent calls append complete entries without losing calls", async () => {
  const { log, entries } = await setup();
  const p = loggedLlmProvider({ id: "test", generate: async () => ({ text: "ok" }) }, log);
  await Promise.all(Array.from({ length: 20 }, () => p.generate({ system: "s", prompt: "p" })));
  expect(await entries()).toHaveLength(20);
});

it("remote embeddings preserve usage across internal batches", async () => {
  const { log, entries } = await setup();
  const remote = await createOpenAICompatibleProvider({
    endpoint: "https://example.test/v1",
    model: "test",
    allowRemote: true,
    fetch: async (_url, init) => {
      const input = JSON.parse(String(init?.body)).input as string[];
      return new Response(
        JSON.stringify({
          data: input.map((_, index) => ({ index, embedding: [1, 0] })),
          usage: { prompt_tokens: input.length * 2 },
        }),
      );
    },
  });
  await loggedEmbeddingProvider(remote, log).embed(
    Array.from({ length: 65 }, () => "private"),
    "document",
    { refCount: 3 },
  );
  expect((await entries())[0]).toMatchObject({ inputCount: 65, refCount: 3, usage: { inputTokens: 130 } });
});

it("rejects invalid usage counters and drops unknown fields", () => {
  expect(
    tokenUsage({ inputTokens: -1, outputTokens: Infinity, cacheReadTokens: "3", prompt: "private" }),
  ).toBeUndefined();
  expect(tokenUsage({ inputTokens: 0, prompt: "private" })).toEqual({ inputTokens: 0 });
});
