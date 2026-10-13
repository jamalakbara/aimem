import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AimemError,
  addHandoff,
  loadIndex,
  loadProject,
  type Notebook,
  nodeFs,
  parseHandoffFile,
  summarizeNotebook,
  validateNotebook,
} from "@aimem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXTURES, fixedRandom } from "./helpers.js";

const clock = { now: () => new Date("2026-10-13T17:00:00Z") };
const deps = { fs: nodeFs, clock, random: fixedRandom(3, 1, 4, 1, 5, 9, 2, 6) };
let root: string;
let nb: Notebook;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "aimem-handoff-"));
  cpSync(join(FIXTURES, "tiny"), root, { recursive: true });
  nb = await loadProject(nodeFs, root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const base = {
  done: "- Dropped the float column\n- Verified monthly totals",
  notDone: "Rounding tests",
  next: "Write fee-split property tests",
  author: "agent:claude-code",
};

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof AimemError) return e.code;
    throw e;
  }
}

describe("addHandoff (03 §3.4, 04 §4)", () => {
  it("writes a dated handoff with all five sections, title and summary derived from Done/Next", async () => {
    const r = await addHandoff(nb, { ...base, task: "tsk-3c4d5e6f", branch: "feat/currency-column" }, deps);
    expect(r.file).toBe(`.aimem/handoffs/${r.ref}-20261013-handoff-2026-10-13-dropped-the-float-column.md`);
    const text = readFileSync(join(root, r.file), "utf8");
    expect(text).toContain('title: "Handoff 2026-10-13: Dropped the float column"\n');
    expect(text).toContain(
      'summary: "Done: Dropped the float column · Next: Write fee-split property tests"\n',
    );
    expect(text).toContain("status: final\n");
    expect(text).toContain("task: tsk-3c4d5e6f\n");
    expect(text).toContain("branch: feat/currency-column\n");
    expect(text).toMatch(
      /## Done\n- Dropped the float column\n- Verified monthly totals\n\n## Not done\nRounding tests\n\n## Next\nWrite fee-split property tests\n\n## Blocked\nnone\n\n## Notes for next agent\nnone\n$/,
    );
    expect(await validateNotebook(nb, { fs: nodeFs, clock })).toEqual([]);
  });

  it("cuts long titles and summaries to the spec limits", async () => {
    const long = "x".repeat(300);
    const r = await addHandoff(nb, { ...base, done: long, next: long }, deps);
    const text = readFileSync(join(root, r.file), "utf8");
    const title = /^title: "?(.*?)"?$/m.exec(text)?.[1] ?? "";
    const summary = /^summary: "?(.*?)"?$/m.exec(text)?.[1] ?? "";
    expect(title.length).toBeLessThanOrEqual(120);
    expect(summary.length).toBeLessThanOrEqual(200);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("is never blocked by the duplicate check", async () => {
    await addHandoff(nb, base, deps);
    expect(await codeOf(addHandoff(nb, base, { ...deps, random: fixedRandom(8, 8, 8, 8, 8, 8, 8, 8) }))).toBe(
      "ok",
    );
  });

  it.each([
    ["empty Done", { done: "  " }, "INVALID_RECORD"],
    ["empty Next", { next: "" }, "INVALID_RECORD"],
    ["unknown task", { task: "tsk-zzzzzzzz" }, "NOT_FOUND"],
    ["task ref that is not a task", { task: "dec-1a2b3c4d" }, "INVALID_RECORD"],
    ["secret", { notes: ["token = ", "Zq8xW3vN0pLk7Rt2Yb5M"].join("") }, "SECRET_DETECTED"],
  ])("refuses %s", async (_n, patch, code) => {
    expect(await codeOf(addHandoff(nb, { ...base, ...patch }, deps))).toBe(code);
  });
});

describe("parseHandoffFile", () => {
  it("reads the five sections, ignoring other text and case", () => {
    expect(
      parseHandoffFile(
        "# Session notes\n\n## Done\n- a\n- b\n\n## not done\nnothing\n\n## Next\nc\n\n## Blocked\nwaiting on API key\n\n## Notes for next agent\nsee logs\n",
      ),
    ).toEqual({
      done: "- a\n- b",
      notDone: "nothing",
      next: "c",
      blocked: "waiting on API key",
      notes: "see logs",
    });
    expect(parseHandoffFile("## Done\nonly this")).toEqual({ done: "only this" });
  });
});

describe("summarizeNotebook (aimem status)", () => {
  it("summarises medium at the fixture clock", async () => {
    const m = await loadProject(nodeFs, join(FIXTURES, "medium"));
    const s = summarizeNotebook(m, await loadIndex(m, { fs: nodeFs }), new Date("2026-10-12T00:00:00Z"));
    expect(s.total).toBe(127);
    expect(s.counts.decision).toEqual({
      proposed: 2,
      accepted: 23,
      rejected: 3,
      superseded: 6,
      deprecated: 1,
    });
    expect(s.urgentTasks.map((t) => t.ref)).toEqual([
      "tsk-631d60cw",
      "tsk-jbnzn535",
      "tsk-2t1712d3",
      "tsk-47qa65h2",
      "tsk-q02m86qx",
    ]);
    expect(s.stale).toHaveLength(9);
    expect(s.unreviewed.inferred).toBe(4);
    expect(s.unreviewed.agent).toBeGreaterThan(0);
    expect(s.lastHandoff?.ref).toBe("hnd-yqdkq1wv");
    expect(s.problems).toBe(0);
    expect(s.claims).toMatch(/M3/);
  });
});
