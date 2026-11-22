import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { addRecord, cryptoRandom, discardRecord, loadProject, nodeFs } from "../src/index.js";
import { FIXTURES } from "./helpers.js";

let root: string;
const deps = { fs: nodeFs, clock: { now: () => new Date("2026-11-22T10:00:00Z") }, random: cryptoRandom };
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aimem-discard-multi-"));
  cpSync(join(FIXTURES, "multirepo"), root, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("refuses to discard a record that a sibling notebook links to (QA 2)", async () => {
  const backend = await loadProject(nodeFs, join(root, "backend"));
  const frontend = await loadProject(nodeFs, join(root, "frontend"));
  const draft = await addRecord(
    backend,
    {
      type: "memory",
      title: "Retry webhooks with backoff",
      summary: "Backoff.",
      body: "x",
      author: "agent:claude-code",
    },
    deps,
  );
  const linker = await addRecord(
    frontend,
    {
      type: "memory",
      title: "Show a retry badge on orders",
      summary: "UI follows the backend retry rule.",
      body: "y",
      author: "agent:claude-code",
      links: [`acme-shop:${draft.ref}`],
    },
    deps,
  );
  await expect(discardRecord(backend, draft.ref, "human:dana", deps)).rejects.toMatchObject({
    code: "INVALID_RECORD",
    message: `${draft.ref} is linked from ${linker.ref} in repo:frontend; supersede it instead of discarding it`,
  });
  expect(existsSync(join(backend.root, draft.file))).toBe(true);
});
