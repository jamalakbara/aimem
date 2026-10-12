import { isValidId, isValidSlug, parseRef, typeFromId } from "@aimem/schema";
import { describe, expect, it } from "vitest";

describe("ids and refs (03 §2.2)", () => {
  it("accepts <prefix>-<8 crockford base32>", () => {
    expect(isValidId("dec-7k3m9q2x")).toBe(true);
    expect(typeFromId("tsk-3f9a1b2c")).toBe("task");
  });
  it.each([
    "dec-7k3m9q2",
    "dec-7k3m9q2xx",
    "dec-7K3M9Q2X",
    "dec-7k3m9q2i",
    "dec-7k3m9q2l",
    "dec-7k3m9q2o",
    "dec-7k3m9q2u",
    "xyz-7k3m9q2x",
    "dec_7k3m9q2x",
  ])("rejects %s", (id) => {
    expect(isValidId(id)).toBe(false);
    expect(typeFromId(id)).toBeUndefined();
  });
  it("parses local and global refs", () => {
    expect(parseRef("dec-7k3m9q2x")).toEqual({ id: "dec-7k3m9q2x" });
    expect(parseRef("acme-platform:inc-8d2e4f6a")).toEqual({ project: "acme-platform", id: "inc-8d2e4f6a" });
  });
});

describe("slugs (03 §2)", () => {
  it("accepts lowercase a-z0-9- up to 60 chars", () => {
    expect(isValidSlug("use-postgres-for-the-ledger")).toBe(true);
    expect(isValidSlug("a".repeat(60))).toBe(true);
  });
  it.each(["", "Use-Postgres", "a_b", "a b", "a".repeat(61)])("rejects %j", (s) => {
    expect(isValidSlug(s)).toBe(false);
  });
});
