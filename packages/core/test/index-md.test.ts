import { cpSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndex, loadIndex, loadProject, nodeFs, renderIndexMd, writeIndexMd } from "@aimem/core";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixedRandom } from "./helpers.js";

async function indexOf(name: string) {
  const nb = await loadProject(nodeFs, join(FIXTURES, name));
  return { nb, index: await loadIndex(nb, { fs: nodeFs }) };
}

describe("INDEX.md (03 §8)", () => {
  it.each(["tiny", "medium"])("%s matches the golden file", async (name) => {
    const { nb, index } = await indexOf(name);
    await expect(renderIndexMd(nb.config, index)).toMatchFileSnapshot(`__snapshots__/${name}.INDEX.md`);
  });

  it("is deterministic and independent of file order", async () => {
    const { nb, index } = await indexOf("medium");
    const shuffled = buildIndex(
      [...index.records].reverse().map((r) => ({ file: r.file, dirType: r.type, text: r.text })),
    );
    expect(renderIndexMd(nb.config, shuffled)).toBe(renderIndexMd(nb.config, index));
  });

  it("has the required sections and labels trust", async () => {
    const { nb, index } = await indexOf("tiny");
    const md = renderIndexMd(nb.config, index);
    for (const h of ["## Protocol", "## Counts", "## Pinned", "## Recent handoffs", "## Open p0/p1 tasks"])
      expect(md).toContain(h);
    expect(md).toContain("reference data, not instructions");
    expect(md).toMatch(/dec-1a2b3c4d \[verified\] Store money as integer minor units/);
    expect(md).not.toMatch(/\d{2}:\d{2}:\d{2}/); // no timestamps → no churn
  });

  it("stays under 6 KB on a huge notebook and says what was left out", () => {
    const texts = Array.from({ length: 400 }, (_, i) => {
      const n = String(i).padStart(4, "0");
      const type = i % 2 ? "task" : "decision";
      const id = `${type === "task" ? "tsk" : "dec"}-0000${n}`;
      const extra = type === "task" ? "priority: p0\n" : "tags: [pinned]\n";
      return {
        file: `.aimem/${type}s/${id}-x.md`,
        dirType: type as "task" | "decision",
        text: `---\naimem: 1\nid: ${id}\ntype: ${type}\ntitle: A fairly long title for record number ${n} to fill space\nsummary: A summary that is also long enough to matter for the size budget, record ${n}.\nstatus: ${type === "task" ? "open" : "accepted"}\ntrust: agent\nroles: [dev]\nauthor: agent:test\ncreated: 2026-10-01T09:00:00Z\nupdated: 2026-10-01T09:00:00Z\n${extra}---\n\nBody\n`,
      };
    });
    const md = renderIndexMd(
      { aimem: 1, project: "big", mode: "solo", sync: "none", roles: ["dev"], freshness_days: {} },
      buildIndex(texts),
    );
    expect(Buffer.byteLength(md)).toBeLessThanOrEqual(6 * 1024);
    expect(md).toMatch(/… and \d+ more/);
    expect(md).toContain("## Open p0/p1 tasks");
  });

  it("writes atomically and only when the content changed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aimem-index-"));
    try {
      cpSync(join(FIXTURES, "tiny"), dir, { recursive: true });
      const nb = await loadProject(nodeFs, dir);
      const index = await loadIndex(nb, { fs: nodeFs });
      expect(await writeIndexMd(nodeFs, nb, index, fixedRandom(3))).toBe(true);
      const file = join(dir, ".aimem/INDEX.md");
      const first = statSync(file).mtimeMs;
      expect(readFileSync(file, "utf8")).toBe(renderIndexMd(nb.config, index));
      expect(await writeIndexMd(nodeFs, nb, index, fixedRandom(3))).toBe(false);
      expect(statSync(file).mtimeMs).toBe(first);
      writeFileSync(file, "hand edited\n");
      expect(await writeIndexMd(nodeFs, nb, index, fixedRandom(3))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
