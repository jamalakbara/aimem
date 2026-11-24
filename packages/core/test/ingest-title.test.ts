import { describe, expect, it } from "vitest";
import { documentToRecord } from "../src/index.js";

describe("import titles", () => {
  it("skips a leading horizontal rule when the title comes from the first line", () => {
    for (const rule of ["---", "***", "___", "----------"]) {
      const r = documentToRecord(`${rule}\n\nPlain text starting with a rule\n\nMore.\n`, "notes.md");
      expect(r.title).toBe("Plain text starting with a rule");
      expect(r.summary).toBe("Plain text starting with a rule");
      expect(r.mode).toBe("whole-document");
    }
  });

  it("falls back to the file name when the document is only rules", () => {
    expect(documentToRecord("---\n\n***\n", "empty-ish.md").title).toBe("empty-ish");
  });

  it("keeps a `#` heading as the title even after a rule", () => {
    expect(
      documentToRecord("---\nJust an intro, not metadata.\n---\n# Real title\n\nBody.\n", "x.md").title,
    ).toBe("Real title");
  });

  it("removes zero-width spaces and word joiners from the title and summary", () => {
    const r = documentToRecord("Zero\u200Bwidth\u2060 title\n\nFirst\u200B sentence here.\n", "z.txt");
    expect(r.title).toBe("Zerowidth title");
    expect(r.summary).not.toMatch(/[\u200B\u2060]/);
  });

  it("keeps joiners that real languages need (ZWNJ in Persian)", () => {
    const r = documentToRecord("می\u200Cخواهم\n\nBody text.\n", "fa.txt");
    expect(r.title).toContain("\u200C");
  });

  it("keeps a summary when the first paragraph is only zero-width characters", () => {
    const r = documentToRecord("# Title A\n\n\u200B\n\nReal text here.\n", "a.md");
    expect(r.summary).toBe("Real text here.");
    const d = documentToRecord(
      "# Use X\n\n## Context\n\n\u200B\n\nWe need X.\n\n## Decision\n\nUse X.\n\n## Consequences\n\nNone.\n",
      "d.md",
    );
    expect(d.type).toBe("decision");
    expect(d.summary).not.toBe("");
  });

  it("does not take a rule as the summary", () => {
    const r = documentToRecord("# My Doc\n\n---\n\nTeks utama.\n", "m.md");
    expect(r.summary).toBe("Teks utama.");
  });

  it("treats a first line of only zero-width characters plus a rule as a rule", () => {
    const r = documentToRecord("\u200B---\n\nReal first line\n\nMore.\n", "r.txt");
    expect(r.title).toBe("Real first line");
  });

  it("keeps a file-name title readable and free of escapes and invisible characters", () => {
    expect(documentToRecord("\u200B\n", "only_invisible*.md").title).toBe("only_invisible*");
    expect(documentToRecord("---\n", "a\u001B[31m\u200Bb\u202Ec.md").title).toBe("a[31mbc");
    expect(documentToRecord("---\n", "\u200B.md").title).toBe("Untitled");
    expect(documentToRecord("---\n", "\u200B.md").summary).toBe("Untitled");
  });
});
