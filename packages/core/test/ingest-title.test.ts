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
    const r = documentToRecord("Zero​width⁠ title\n\nFirst​ sentence here.\n", "z.txt");
    expect(r.title).toBe("Zerowidth title");
    expect(r.summary).not.toMatch(/[​⁠]/);
  });

  it("keeps joiners that real languages need (ZWNJ in Persian)", () => {
    const r = documentToRecord("می‌خواهم\n\nBody text.\n", "fa.txt");
    expect(r.title).toContain("‌");
  });
});
