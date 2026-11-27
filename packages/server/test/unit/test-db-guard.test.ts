import { describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../db/helpers.js";

describe("database tests never skip (CI-1, QA W9)", () => {
  it("fails when no test database is configured", () => {
    expect(() => testDatabaseUrl({})).toThrow(/AIMEM_TEST_DATABASE_URL is not set.*never skip/);
    expect(testDatabaseUrl({ AIMEM_TEST_DATABASE_URL: "postgres://x" })).toBe("postgres://x");
  });
});
