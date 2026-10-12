import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Fs,
  listRecordFiles,
  nodeFs,
  readRecordFile,
  setField,
  writeFileAtomic,
  writeRecordFile,
} from "@aimem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXTURES, fixedRandom } from "./helpers.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aimem-core-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** nodeFs with one operation made to fail. */
function failing(op: keyof Fs): Fs {
  return {
    ...nodeFs,
    [op]: async () => {
      throw new Error(`simulated ${op} failure`);
    },
  };
}

describe("writeFileAtomic", () => {
  it("creates parent directories and writes the content", async () => {
    const file = join(dir, "a/b/c.md");
    await writeFileAtomic(nodeFs, file, "hello\n", fixedRandom(7));
    expect(readFileSync(file, "utf8")).toBe("hello\n");
    expect(readdirSync(join(dir, "a/b"))).toEqual(["c.md"]);
  });

  it.each(["writeFile", "rename"] as const)(
    "leaves the original intact and no temp file when %s fails",
    async (op) => {
      const file = join(dir, "rec.md");
      writeFileSync(file, "original\n");
      await expect(writeFileAtomic(failing(op), file, "new content\n", fixedRandom(7))).rejects.toThrow(
        /simulated/,
      );
      expect(readFileSync(file, "utf8")).toBe("original\n");
      expect(readdirSync(dir)).toEqual(["rec.md"]);
    },
  );
});

describe("record files", () => {
  it("reads, edits and writes a record, preserving everything else", async () => {
    const file = join(dir, "dec-0123abcd-x.md");
    const text = "---\naimem: 1\nid: dec-0123abcd\nstatus: proposed\nx_unknown: 1\n---\n\nBody\n";
    writeFileSync(file, text);
    const r = await readRecordFile(nodeFs, file);
    if (!r.ok) throw new Error(r.message);
    setField(r.record, "status", "accepted");
    await writeRecordFile(nodeFs, file, r.record, fixedRandom(1));
    expect(readFileSync(file, "utf8")).toBe(text.replace("proposed", "accepted"));
  });

  it("reports V001 with the file content left untouched", async () => {
    const file = join(dir, "broken.md");
    writeFileSync(file, "no frontmatter\n");
    const r = await readRecordFile(nodeFs, file);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("V001");
  });

  it("lists record files per type directory, ignoring other files", async () => {
    const files = await listRecordFiles(nodeFs, join(FIXTURES, "tiny/.aimem"));
    expect(files).toHaveLength(8);
    expect(new Set(files.map((f) => f.dirType))).toEqual(new Set(["decision", "task", "memory", "handoff"]));
    expect(files.every((f) => f.path.endsWith(".md"))).toBe(true);
    expect(files.map((f) => f.path)).toEqual([...files.map((f) => f.path)].sort());
  });

  it("lists nothing for a notebook without record directories", async () => {
    expect(await listRecordFiles(nodeFs, dir)).toEqual([]);
  });
});
