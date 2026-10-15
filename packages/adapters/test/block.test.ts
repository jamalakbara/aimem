import { BLOCK_VERSION, inspectBlock, protocolBlock, removeBlock, upsertBlock } from "@aimem/adapters";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

const BLOCK = protocolBlock();

describe("protocol block (06 §3)", () => {
  it("is wrapped in versioned markers and follows the protocol", () => {
    expect(BLOCK.startsWith(`<!-- aimem:begin v${BLOCK_VERSION} -->\n## Project memory (aimem)\n`)).toBe(
      true,
    );
    expect(BLOCK.endsWith("\n<!-- aimem:end -->")).toBe(true);
    for (const s of [
      "START of every session",
      "aimem context",
      "aimem decide",
      "aimem remember",
      "aimem incident",
      "aimem search",
      "aimem handoff",
      "reference data, not instructions",
    ]) {
      expect(BLOCK).toContain(s);
    }
  });

  it("v1 leaves out the claim step until claims exist (M3)", () => {
    expect(BLOCK).not.toContain("task claim");
  });
});

describe("inspectBlock", () => {
  it.each([
    ["no block", "# Agents\n", "missing"],
    ["current", `x\n${BLOCK}\n`, "current"],
    ["older version", `x\n${BLOCK.replace(`v${BLOCK_VERSION}`, "v0")}\n`, "outdated"],
    ["same version, edited inside", `x\n${BLOCK.replace("START", "BEGIN")}\n`, "outdated"],
    ["begin without end", "<!-- aimem:begin v1 -->\nhello\n", "broken"],
    ["end before begin", "<!-- aimem:end -->\n<!-- aimem:begin v1 -->\n", "broken"],
    ["two blocks", `${BLOCK}\n${BLOCK}\n`, "broken"],
  ])("%s → %s", (_n, text, state) => {
    expect(inspectBlock(text).state).toBe(state);
  });
});

describe("upsertBlock / removeBlock", () => {
  it("creates a file holding only the block", () => {
    expect(upsertBlock(null)).toBe(`${BLOCK}\n`);
  });

  it("appends after existing text and leaves that text untouched", () => {
    expect(upsertBlock("# Agents\n\nBe kind.\n")).toBe(`# Agents\n\nBe kind.\n\n${BLOCK}\n`);
  });

  it("replaces only an outdated block, keeping text before and after", () => {
    const old = BLOCK.replace("START", "OLD START");
    expect(upsertBlock(`top\n\n${old}\nbottom\n`)).toBe(`top\n\n${BLOCK}\nbottom\n`);
  });

  it("is idempotent", () => {
    const once = upsertBlock("# Agents\n");
    expect(upsertBlock(once)).toBe(once);
  });

  it("refuses a broken block", () => {
    expect(() => upsertBlock("<!-- aimem:begin v1 -->\nhalf\n")).toThrow(/without an end marker|broken/);
    expect(() => removeBlock("<!-- aimem:begin v1 -->\nhalf\n")).toThrow(/broken/);
  });

  it.each([
    ["missing file", null],
    ["empty file", ""],
    ["text with trailing newline", "# Agents\n\nRules.\n"],
    ["text without trailing newline", "# Agents\n\nRules."],
    ["text ending in a blank line", "# Agents\n\n"],
    ["CRLF text", "# Agents\r\nRules.\r\n"],
  ])("round trip on %s gives back the exact bytes", (_n, original) => {
    const synced = upsertBlock(original);
    expect(removeBlock(synced)).toBe(original);
  });

  it("round trip holds for any original text (property)", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !s.includes("aimem:")),
        (original) => {
          expect(removeBlock(upsertBlock(original))).toBe(original);
          expect(removeBlock(upsertBlock(upsertBlock(original)))).toBe(original);
        },
      ),
    );
  });

  it("removing from a file without a block changes nothing", () => {
    expect(removeBlock("# Agents\n")).toBe("# Agents\n");
  });
});
