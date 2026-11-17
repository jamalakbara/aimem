import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadIndex, loadProject, nodeFs, recordUsage } from "@aimem/core";
import { afterEach, beforeEach, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";

let dir: string;
const clock = { now: () => new Date("2026-11-18T00:00:00Z") };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aimem-usage-"));
  cpSync(join(FIXTURES, "tiny"), dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const open = async () => {
  const nb = await loadProject(nodeFs, dir);
  return { nb, index: await loadIndex(nb, { fs: nodeFs }) };
};

it("appends only canonical distinct known refs and never changes notebook records", async () => {
  const { nb, index } = await open();
  const before = index.records.map((r) => r.text);
  const result = await recordUsage(
    nb,
    index,
    { session: "opaque_01", refs: ["dec-1a2b3c4d", `${nb.config.project}:dec-1a2b3c4d`, "mem-5e6f7g8h"] },
    { fs: nodeFs, clock },
  );
  expect(result.file).toBe(".aimem/.cache/usage.jsonl");
  const entry = JSON.parse(readFileSync(join(nb.dir, ".cache/usage.jsonl"), "utf8"));
  expect(entry).toEqual({
    version: 1,
    time: "2026-11-18T00:00:00.000Z",
    session: "opaque_01",
    source: "agent",
    refs: ["dec-1a2b3c4d", "mem-5e6f7g8h"],
  });
  expect((await loadIndex(nb, { fs: nodeFs })).records.map((r) => r.text)).toEqual(before);
});

it("appends complete independent events for concurrent reporters", async () => {
  const { nb, index } = await open();
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      recordUsage(nb, index, { session: `s${i}`, refs: ["dec-1a2b3c4d"] }, { fs: nodeFs, clock }),
    ),
  );
  const entries = readFileSync(join(nb.dir, ".cache/usage.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  expect(entries).toHaveLength(20);
  expect(new Set(entries.map((e) => e.session)).size).toBe(20);
});

it.each(["", "../escape", "a/b", "x".repeat(65), "session\nforged"])(
  "rejects unsafe session %s without any writes",
  async (session) => {
    const { nb, index } = await open();
    const fs = {
      ...nodeFs,
      mkdir: async () => {
        throw new Error("must not mkdir");
      },
      appendFile: async () => {
        throw new Error("must not append");
      },
    };
    await expect(
      recordUsage(nb, index, { session, refs: ["dec-1a2b3c4d"] }, { fs, clock }),
    ).rejects.toMatchObject({ code: "USAGE" });
  },
);

it("rejects missing, excessive, invalid, foreign or unknown refs before writing", async () => {
  const { nb, index } = await open();
  let writes = 0;
  for (const { refs, code } of [
    { refs: [], code: "USAGE" },
    { refs: Array(101).fill("dec-1a2b3c4d"), code: "USAGE" },
    { refs: ["../record"], code: "USAGE" },
    { refs: ["another:dec-1a2b3c4d"], code: "NOT_FOUND" },
    { refs: ["dec-00000000"], code: "NOT_FOUND" },
  ]) {
    await expect(
      recordUsage(
        nb,
        index,
        { session: "s1", refs },
        {
          fs: {
            ...nodeFs,
            mkdir: async () => {
              writes++;
              throw new Error("must not mkdir");
            },
            appendFile: async () => {
              writes++;
            },
          },
          clock,
        },
      ),
    ).rejects.toMatchObject({ code });
  }
  expect(writes).toBe(0);
});

it("fails explicitly for injected filesystems without append support", async () => {
  const { nb, index } = await open();
  await expect(
    recordUsage(
      nb,
      index,
      { session: "s1", refs: ["dec-1a2b3c4d"] },
      { fs: { ...nodeFs, appendFile: undefined }, clock },
    ),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
});

it("reports storage failure with a bounded error and no raw filesystem details", async () => {
  const { nb, index } = await open();
  const fs = {
    ...nodeFs,
    appendFile: async () => {
      throw new Error("private filesystem detail");
    },
  };
  await expect(
    recordUsage(nb, index, { session: "s1", refs: ["dec-1a2b3c4d"] }, { fs, clock }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED", message: "cannot append local usage log" });
});
