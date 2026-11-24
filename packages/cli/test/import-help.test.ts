import { describe, expect, it } from "vitest";
import { cli } from "./helpers.js";

describe("aimem import --help", () => {
  it("names every supported format", async () => {
    const r = await cli(["import", "--help"], {});
    for (const ext of [".md", ".txt", ".csv", ".xlsx", ".docx", ".pdf"]) expect(r.stdout).toContain(ext);
  });
});
