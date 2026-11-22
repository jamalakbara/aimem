import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addRecord, loadProject, nodeFs, verifyRecords } from "@aimem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";

let root: string;
let n = 0;
const deps = {
  fs: nodeFs,
  clock: { now: () => new Date("2026-11-21T08:00:00Z") },
  random: { bytes: (k: number) => Uint8Array.from({ length: k }, () => n++ % 256) },
};
const decision = (author: string) => ({
  type: "decision" as const,
  title: "Queue retries with exponential backoff",
  summary: "Retries back off exponentially up to five minutes.",
  body: "## Context\nx\n\n## Decision\nx\n\n## Consequences\nx\n\n## Alternatives\nx",
  author,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aimem-review-"));
  cpSync(join(FIXTURES, "tiny"), root, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const setConfig = (extra: string, mode = "team") => {
  const file = join(root, ".aimem/project.yaml");
  writeFileSync(file, `${readFileSync(file, "utf8").replace("mode: solo", `mode: ${mode}`)}${extra}`);
};

describe("write_policy.durable_requires_review (03 §6)", () => {
  it("keeps a human's decision unreviewed in team mode until another person verifies it", async () => {
    setConfig("");
    const nb = await loadProject(nodeFs, root);
    const r = await addRecord(nb, decision("human:dana"), deps);
    expect(r.trust).toBe("agent");
    expect(r.warnings).toContain(
      `decision records need review by another person in this notebook; ask a teammate to run aimem verify ${r.ref}`,
    );
    await expect(verifyRecords(nb, [r.ref], "human:dana", deps)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: `${r.ref} needs review by someone other than its author (write_policy.durable_requires_review); ask a teammate to run aimem verify ${r.ref}`,
    });
    await expect(verifyRecords(nb, [r.ref], "agent:claude-code", deps)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message:
        "only a human author can verify records; a person runs aimem verify with AIMEM_AUTHOR=human:<handle> or git config user.name",
    });
    await verifyRecords(nb, [r.ref], "human:rina", deps);
    expect(readFileSync(join(root, r.file), "utf8")).toContain("trust: verified");
    const memo = await addRecord(
      nb,
      { ...decision("human:dana"), type: "memory", title: "Retry queue drains nightly", body: "Body." },
      deps,
    );
    expect(memo.trust).toBe("verified");
  });

  it("explains a write_policy written as a single value instead of a section", async () => {
    setConfig("write_policy: pr\n");
    await expect(loadProject(nodeFs, root)).rejects.toMatchObject({
      code: "INVALID_RECORD",
      message:
        "project.yaml: write_policy must be a section with nested keys, for example:\n  write_policy:\n    agent_commits: pr",
    });
  });

  it("is off in solo mode and when set to false", async () => {
    const solo = await addRecord(await loadProject(nodeFs, root), decision("human:dana"), deps);
    expect(solo.trust).toBe("verified");
    setConfig("write_policy:\n  durable_requires_review: false\n");
    const off = await addRecord(
      await loadProject(nodeFs, root),
      {
        ...decision("human:dana"),
        title: "Park poison messages in a dead-letter store",
        summary: "Failed messages go to a separate store for inspection.",
      },
      deps,
    );
    expect(off.trust).toBe("verified");
  });
});
