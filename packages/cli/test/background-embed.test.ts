import { cpSync, existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashEmbedder } from "@aimem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cli, FIXTURES } from "./helpers.js";

let dir: string;
const env = { AIMEM_AUTHOR: "human:dana" };
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "aimem-bg-"));
  cpSync(join(FIXTURES, "tiny"), dir, { recursive: true });
  // A vector cache exists, as after `aimem index --embeddings`.
  expect((await cli(["index", "--embeddings", "--dir", dir], { env, embedder: hashEmbedder() })).code).toBe(
    0,
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function spies() {
  const spawned: { args: string[]; cwd: string }[] = [];
  let loads = 0;
  return {
    spawned,
    loads: () => loads,
    deps: {
      env,
      spawnBackground: (args: string[], cwd: string) => spawned.push({ args, cwd }),
      loadEmbedder: async () => {
        loads++;
        return { available: true as const, provider: hashEmbedder() };
      },
    },
  };
}
const remember = (title: string, extra: Record<string, unknown> = {}) =>
  cli(
    ["remember", "--title", title, "--summary", `${title}.`, "--body", "Body.", "--json", "--dir", dir],
    extra,
  );

describe("T1: CLI writes refresh vectors in the background", () => {
  it("returns without loading the model and starts one refresh after the write", async () => {
    const s = spies();
    const r = await remember("Ledger exports run nightly", s.deps);
    expect(r.code).toBe(0);
    expect(s.loads()).toBe(0);
    expect(s.spawned).toEqual([
      { args: ["index", "--embeddings", "--background", "--quiet", "--dir", dir], cwd: dir },
    ]);
  });

  it("keeps the refresh inside the write with AIMEM_EMBED_SYNC=1", async () => {
    const s = spies();
    const r = await remember("Ledger exports run nightly", {
      ...s.deps,
      env: { ...env, AIMEM_EMBED_SYNC: "1" },
    });
    expect(r.code).toBe(0);
    expect(s.loads()).toBe(1);
    expect(s.spawned).toEqual([]);
  });

  it("does not start a refresh when the write fails", async () => {
    const s = spies();
    const dup = await remember("Payment provider sends amounts as strings", s.deps);
    expect(dup.code).toBe(3);
    expect(s.spawned).toEqual([]);
  });
});

describe("aimem index --embeddings --background", () => {
  const cache = () => join(dir, ".aimem/.cache");

  it("refreshes, never downloads, and removes its lock", async () => {
    let allowed: boolean | undefined;
    const r = await cli(["index", "--embeddings", "--background", "--json", "--dir", dir], {
      env,
      loadEmbedder: async (_c, allowDownload) => {
        allowed = allowDownload;
        return { available: true, provider: hashEmbedder() };
      },
    });
    expect(r.code).toBe(0);
    expect(allowed).toBe(false);
    expect(r.json.data).toMatchObject({ passes: 1, embeddings: { available: true } });
    expect(existsSync(join(cache(), "embed-refresh.lock"))).toBe(false);
  });

  it("queues another pass instead of running twice, and ignores a stale lock", async () => {
    writeFileSync(join(cache(), "embed-refresh.lock"), "busy");
    const queued = await cli(["index", "--embeddings", "--background", "--json", "--dir", dir], {
      env,
      embedder: hashEmbedder(),
    });
    expect(queued.json.data).toEqual({ queued: true });
    expect(existsSync(join(cache(), "embed-refresh.pending"))).toBe(true);
    const old = new Date(Date.now() - 11 * 60_000);
    utimesSync(join(cache(), "embed-refresh.lock"), old, old);
    const ran = await cli(["index", "--embeddings", "--background", "--json", "--dir", dir], {
      env,
      embedder: hashEmbedder(),
      clock: { now: () => new Date() },
    });
    expect(ran.json.data.passes).toBe(1);
    expect(existsSync(join(cache(), "embed-refresh.pending"))).toBe(false);
  });

  it("takes another pass when a write queues one just as the lock is released", async () => {
    const { nodeFs } = await import("@aimem/core");
    let raced = false;
    const fs = {
      ...nodeFs,
      unlink: async (p: string) => {
        await nodeFs.unlink(p);
        if (!raced && p.endsWith("embed-refresh.lock")) {
          raced = true;
          writeFileSync(join(cache(), "embed-refresh.pending"), "");
        }
      },
    };
    const r = await cli(["index", "--embeddings", "--background", "--json", "--dir", dir], {
      env,
      fs,
      embedder: hashEmbedder(),
    });
    expect(r.json.data.passes).toBe(2);
    expect(existsSync(join(cache(), "embed-refresh.pending"))).toBe(false);
    expect(existsSync(join(cache(), "embed-refresh.lock"))).toBe(false);
  });
});
