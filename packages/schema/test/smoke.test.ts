import { SPEC_VERSION } from "@aimem/schema";
import { describe, expect, it } from "vitest";

describe("@aimem/schema scaffold", () => {
  it("exports the spec major version", () => {
    expect(SPEC_VERSION).toBe(1);
  });
});
