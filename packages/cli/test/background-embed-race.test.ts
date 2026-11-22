import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashEmbedder, nodeFs } from "@aimem/core";
import { afterEach, beforeEach, expect, it } from "vitest";
import { cli, FIXTURES } from "./helpers.js";

let dir: string;
const env = { AIMEM_AUTHOR: "human:dana" };
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "aimem-race-"));
  cpSync(join(FIXTURES, "tiny"), dir, { recursive: true });
  await cli(["index", "--embeddings", "--dir", dir], { env, embedder: hashEmbedder() });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const bg = (extra: Record<string, unknown> = {}) =>
  cli(["index", "--embeddings", "--background", "--json", "--dir", dir], {
    env,
    embedder: hashEmbedder(),
    ...extra,
  });

it("A: two refreshes started together both run (non-atomic lock)", async () => {
  const [a, b] = await Promise.all([bg(), bg()]);
  console.log(
    "RAW",
    JSON.stringify([
      a.code,
      a.stdout?.slice(0, 200),
      a.stderr?.slice(0, 200),
      b.code,
      b.stdout?.slice(0, 200),
      b.stderr?.slice(0, 200),
    ]),
  );
  const ran = [a, b].filter((r) => r.json?.data?.passes !== undefined).length;
  expect([a.code, b.code]).toEqual([0, 0]);
  expect(ran).toBe(1);
});

it("B: pending written after the runner's last check is orphaned", async () => {
  const cache = join(dir, ".aimem/.cache");
  // Queued run: sees a fresh lock, but the runner finishes before it writes `pending`.
  writeFileSync(join(cache, "embed-refresh.lock"), "busy");
  const fs = {
    ...nodeFs,
    writeFile: async (p: string, d: string | Uint8Array) => {
      if (p.endsWith("embed-refresh.pending")) await nodeFs.unlink(join(cache, "embed-refresh.lock")); // runner exits now
      return nodeFs.writeFile(p, d);
    },
  };
  const q = await bg({ fs });
  console.log(
    "B queued:",
    q.json.data,
    "lock:",
    existsSync(join(cache, "embed-refresh.lock")),
    "pending:",
    existsSync(join(cache, "embed-refresh.pending")),
  );
  expect(q.json.data.passes).toBe(1); // took the lock itself instead of leaving `pending` behind
  expect(existsSync(join(cache, "embed-refresh.pending"))).toBe(false);
});

it("C: takes over at once a fresh lock left by a process that is gone", async () => {
  const cache = join(dir, ".aimem/.cache");
  const gone = spawnSync(process.execPath, ["-e", ""]).pid; // has exited
  writeFileSync(join(cache, "embed-refresh.lock"), `${gone} ${new Date().toISOString()}`);
  const r = await bg();
  expect(r.json.data.passes).toBe(1);
  expect(existsSync(join(cache, "embed-refresh.lock"))).toBe(false);
});

it("D: still queues behind a fresh lock whose process is alive", async () => {
  const cache = join(dir, ".aimem/.cache");
  writeFileSync(join(cache, "embed-refresh.lock"), `${process.pid} ${new Date().toISOString()}`);
  const r = await bg();
  expect(r.json.data).toEqual({ queued: true });
});
