import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashEmbedder } from "@aimem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cli, FIXTURES, fakeGit } from "./helpers.js";

let dir: string;
const env = { AIMEM_AUTHOR: "human:dana" };
const embedder = hashEmbedder(64);
const lock = () => join(dir, ".aimem/.cache/embed-refresh.lock");

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "aimem-hints-"));
  cpSync(join(FIXTURES, "tiny"), dir, { recursive: true });
  expect((await cli(["index", "--embeddings", "--dir", dir], { env, embedder })).code).toBe(0);
  // A CLI write that leaves the refresh to the background: coverage is now below 100%.
  const w = await cli(
    [
      "remember",
      "--title",
      "Ledger exports run nightly",
      "--summary",
      "Nightly.",
      "--body",
      "Body.",
      "--json",
      "--dir",
      dir,
    ],
    { env, spawnBackground: () => undefined },
  );
  expect(w.code).toBe(0);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const running = () => writeFileSync(lock(), `${process.pid} ${new Date().toISOString()}`);
const searchCheck = async () => {
  const doc = await cli(["doctor", "--json", "--dir", dir], { git: fakeGit(), embedder, env });
  return doc.json.data.checks.find((c: { name: string }) => c.name === "search");
};

describe("T1 follow-up: say when the semantic index is still catching up", () => {
  it("doctor: a running background refresh is info, not a request to run index", async () => {
    running();
    const check = await searchCheck();
    expect(check.status).toBe("info");
    expect(check.detail).toMatch(/updating in the background \(coverage \d+%\)/);
    expect(check.detail).not.toMatch(/run aimem index --embeddings/);
  });

  it("doctor: without a running refresh, a gap still asks for aimem index --embeddings", async () => {
    // A lock whose process is gone does not count as running.
    writeFileSync(lock(), `999999999 ${new Date().toISOString()}`);
    const check = await searchCheck();
    expect(check.status).toBe("warn");
    expect(check.detail).toMatch(/coverage \d+%; run aimem index --embeddings/);
  });

  it("search and context warn while the refresh runs", async () => {
    running();
    const s = await cli(["search", "ledger exports", "--json", "--dir", dir], { embedder, env });
    expect(s.json.warnings).toContain(
      "semantic index is updating in the background; records written in the last few seconds may rank lower",
    );
    const c = await cli(["context", "--task", "ledger exports", "--json", "--dir", dir], {
      embedder,
      env,
      git: fakeGit(),
    });
    expect(JSON.stringify(c.json.warnings)).toMatch(/updating in the background/);
  });

  it("search warns with the fix when the index is incomplete and nothing is refreshing", async () => {
    const s = await cli(["search", "ledger exports", "--json", "--dir", dir], { embedder, env });
    expect(s.json.warnings.join("\n")).toMatch(
      /semantic index covers \d+% of records; run aimem index --embeddings/,
    );
  });

  it("no warning once the index is complete", async () => {
    await cli(["index", "--embeddings", "--dir", dir], { env, embedder });
    const s = await cli(["search", "ledger exports", "--json", "--dir", dir], { embedder, env });
    expect((s.json.warnings ?? []).join("\n")).not.toMatch(/semantic index/);
    expect((await searchCheck()).status).toBe("ok");
  });
});
