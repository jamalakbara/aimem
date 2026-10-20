import { toPosix } from "@aimem/core";
import { describe, expect, it } from "vitest";

describe("toPosix (03 §10: stored and printed paths use /)", () => {
  it.each([
    [".aimem\\decisions\\dec-1a2b3c4d-x.md", ".aimem/decisions/dec-1a2b3c4d-x.md"],
    ["docs\\AI.md", "docs/AI.md"],
    ["docs/AI.md", "docs/AI.md"],
    ["mixed\\a/b\\c.md", "mixed/a/b/c.md"],
    ["AGENTS.md", "AGENTS.md"],
    ["", ""],
  ])("%j → %j", (input, want) => {
    expect(toPosix(input)).toBe(want);
  });
});
