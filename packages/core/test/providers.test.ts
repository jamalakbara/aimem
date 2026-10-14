import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createLocalProvider,
  createOpenAICompatibleProvider,
  DEFAULT_LOCAL_MODEL,
  LOCAL_MODELS,
  loadEmbeddingProvider,
} from "@aimem/core";
import { afterAll, describe, expect, it } from "vitest";

const emptyModels = mkdtempSync(join(tmpdir(), "aimem-models-"));
afterAll(() => rmSync(emptyModels, { recursive: true, force: true }));

/** Fake transformers loader: records calls, returns unit vectors. */
function fakeLoader(dims = 4) {
  const calls: { model: string; texts: string[]; options: unknown; allowRemote: boolean }[] = [];
  let allowRemote = false;
  const loader = {
    calls,
    async load(hub: string, setup: { cacheDir: string; allowRemote: boolean }) {
      allowRemote = setup.allowRemote;
      return async (texts: string[], options: unknown) => {
        calls.push({ model: hub, texts, options, allowRemote });
        return texts.map((_, i) => Array.from({ length: dims }, (_, k) => (k === i % dims ? 1 : 0)));
      };
    },
  };
  return loader;
}

describe("local provider (15 §4.2)", () => {
  it("knows the three candidates and has a default", () => {
    expect(Object.keys(LOCAL_MODELS).sort()).toEqual([
      "bge-m3",
      "multilingual-e5-small",
      "paraphrase-multilingual-minilm",
    ]);
    expect(LOCAL_MODELS[DEFAULT_LOCAL_MODEL]).toBeDefined();
  });

  it("adds the model's query/document prefixes and pooling, and reports its identity", async () => {
    const loader = fakeLoader(384);
    const p = await createLocalProvider({
      model: "multilingual-e5-small",
      cacheDir: emptyModels,
      allowDownload: false,
      loader,
    });
    expect(p).toMatchObject({ id: "local:multilingual-e5-small", dimensions: 384 });
    await p.embed(["a doc"], "document");
    await p.embed(["a question"], "query");
    expect(loader.calls[0]?.texts).toEqual(["passage: a doc"]);
    expect(loader.calls[1]?.texts).toEqual(["query: a question"]);
    expect(loader.calls[0]?.options).toMatchObject({ pooling: "mean", normalize: true });
    expect(loader.calls[0]?.allowRemote).toBe(false);
    const bge = await createLocalProvider({
      model: "bge-m3",
      cacheDir: emptyModels,
      allowDownload: true,
      loader: fakeLoader(1024),
    });
    expect(bge.dimensions).toBe(1024);
  });

  it("'auto' resolves to the default model; unknown models are refused", async () => {
    const p = await createLocalProvider({
      model: "auto",
      cacheDir: emptyModels,
      allowDownload: false,
      loader: fakeLoader(LOCAL_MODELS[DEFAULT_LOCAL_MODEL].dimensions),
    });
    expect(p.id).toBe(`local:${DEFAULT_LOCAL_MODEL}`);
    await expect(
      createLocalProvider({
        model: "gpt-embed-9000",
        cacheDir: emptyModels,
        allowDownload: false,
        loader: fakeLoader(),
      }),
    ).rejects.toThrow(/unknown local model/);
  });

  it("without a downloaded model and downloads disabled, the real loader fails with a clear message", async () => {
    await expect(
      createLocalProvider({ model: "multilingual-e5-small", cacheDir: emptyModels, allowDownload: false }),
    ).rejects.toThrow(/not downloaded/);
  });
});

describe("openai-compatible provider (15 §4.2, §12)", () => {
  function fakeFetch(dims = 3) {
    const requests: { url: string; init: RequestInit }[] = [];
    const fetch = async (url: string | URL, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} });
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      const data = body.input
        .map((_, i) => ({ index: i, embedding: Array.from({ length: dims }, (_, k) => (k === 0 ? 1 : i)) }))
        .reverse();
      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    return { fetch, requests };
  }

  it("refuses to send text unless allow_remote is true", async () => {
    await expect(
      createOpenAICompatibleProvider({
        endpoint: "http://localhost:11434/v1",
        model: "nomic-embed",
        allowRemote: false,
        fetch: fakeFetch().fetch,
      }),
    ).rejects.toThrow(/allow_remote/);
  });

  it("posts to /embeddings with the key from the environment, keeps input order, and probes dimensions", async () => {
    const f = fakeFetch(5);
    const p = await createOpenAICompatibleProvider({
      endpoint: "http://localhost:11434/v1/",
      model: "nomic-embed",
      apiKey: "test-key",
      allowRemote: true,
      fetch: f.fetch,
    });
    expect(p).toMatchObject({ id: "openai-compatible:nomic-embed@localhost:11434", dimensions: 5 });
    const out = await p.embed(["x", "y"], "document");
    expect(out.map((v) => v[1])).toEqual([0, 1]);
    const last = f.requests.at(-1);
    expect(last?.url).toBe("http://localhost:11434/v1/embeddings");
    expect(((last?.init.headers ?? {}) as Record<string, string>).authorization).toBe("Bearer test-key");
    expect(JSON.parse(String(last?.init.body))).toEqual({ model: "nomic-embed", input: ["x", "y"] });
  });

  it("reports HTTP errors without leaking the key", async () => {
    const fetch = async () => new Response("nope", { status: 401 });
    const err = await createOpenAICompatibleProvider({
      endpoint: "https://api.example.com/v1",
      model: "m",
      apiKey: "secret-key-123",
      allowRemote: true,
      fetch,
    }).catch((e) => e as Error);
    expect(String(err)).toMatch(/401/);
    expect(String(err)).not.toContain("secret-key-123");
  });
});

describe("loadEmbeddingProvider", () => {
  const base = { cacheDir: emptyModels, allowDownload: false, env: {} };
  it.each([
    [{ provider: "none" }, /provider is none/],
    [{ provider: "openai-compatible", endpoint: "http://x/v1", model: "m" }, /allow_remote/],
    [{ provider: "openai-compatible", allow_remote: true }, /endpoint and model/],
    [{ provider: "local" }, /not downloaded/],
  ] as const)("%j → off with a reason", async (embeddings, reason) => {
    const s = await loadEmbeddingProvider({ retrieval: { embeddings } }, base);
    expect(s.available).toBe(false);
    if (!s.available) expect(s.reason).toMatch(reason);
  });

  it("builds a local provider through the injected loader", async () => {
    const s = await loadEmbeddingProvider(
      { retrieval: { embeddings: { provider: "local", model: "paraphrase-multilingual-minilm" } } },
      { ...base, loader: fakeLoader(384) },
    );
    expect(s.available && s.provider.id).toBe("local:paraphrase-multilingual-minilm");
  });

  it("reads the remote key from AIMEM_EMBEDDINGS_KEY", async () => {
    let auth = "";
    const fetch = async (_u: string | URL, init?: RequestInit) => {
      auth = ((init?.headers ?? {}) as Record<string, string>).authorization ?? "";
      return new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }] }), { status: 200 });
    };
    const s = await loadEmbeddingProvider(
      {
        retrieval: {
          embeddings: {
            provider: "openai-compatible",
            endpoint: "http://x/v1",
            model: "m",
            allow_remote: true,
          },
        },
      },
      { ...base, env: { AIMEM_EMBEDDINGS_KEY: "k1" }, fetch },
    );
    expect(s.available).toBe(true);
    expect(auth).toBe("Bearer k1");
  });
});
