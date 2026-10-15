import { baseFrontmatterSchema, RECORD_TYPES, recordSchema, STATUSES, TYPE_PREFIX } from "@aimem/schema";
import { describe, expect, it } from "vitest";
import { minimal, specExample, validSource } from "./helpers.js";

const REQUIRED = [
  "aimem",
  "id",
  "type",
  "title",
  "summary",
  "status",
  "trust",
  "roles",
  "author",
  "created",
  "updated",
];

describe("recordSchema (03 §2–§3)", () => {
  it("parses the 03 §2 example unchanged", () => {
    expect(recordSchema.parse(specExample)).toEqual(specExample);
  });

  it.each(RECORD_TYPES)("parses minimal %s with every allowed status", (type) => {
    for (const status of STATUSES[type]) {
      expect(recordSchema.safeParse(minimal(type, TYPE_PREFIX[type], status)).success).toBe(true);
    }
  });

  it.each(REQUIRED)("fails when required field %s is missing", (field) => {
    const fm = minimal("memory", "mem", "active");
    delete fm[field];
    expect(baseFrontmatterSchema.safeParse(fm).success).toBe(false);
    expect(recordSchema.safeParse(fm).success).toBe(false);
  });

  it("a status not allowed for the type fails recordSchema but passes baseFrontmatterSchema (V004 vs V002)", () => {
    const fm = minimal("handoff", "hnd", "accepted");
    expect(baseFrontmatterSchema.safeParse(fm).success).toBe(true);
    expect(recordSchema.safeParse(fm).success).toBe(false);
  });

  it.each([
    ["trust", "trusted"],
    ["type", "note"],
    ["id", "dec-123"],
    ["roles", []],
    ["created", "2026-10-08 07:12"],
    ["created", "2026-10-08T07:12:00+07:00"],
    ["verified", "2026-10-08T00:00:00Z"],
    ["title", "x".repeat(121)],
    ["title", ""],
    ["summary", ""],
    ["aimem", 1.5],
    ["author", "akbar"],
    ["links", ["not a ref"]],
  ])("rejects %s = %j", (field, value) => {
    const fm = { ...minimal("memory", "mem", "active"), [field]: value };
    expect(baseFrontmatterSchema.safeParse(fm).success).toBe(false);
  });

  it("allows a summary over 200 chars (V009 is a warning, not a schema error)", () => {
    const fm = { ...minimal("memory", "mem", "active"), summary: "x".repeat(250) };
    expect(recordSchema.safeParse(fm).success).toBe(true);
  });

  it("accepts a newer spec major version so the validator can report V016", () => {
    expect(baseFrontmatterSchema.safeParse({ ...minimal("memory", "mem", "active"), aimem: 2 }).success).toBe(
      true,
    );
  });

  it("validates type-specific fields", () => {
    const task = minimal("task", "tsk", "open");
    expect(
      recordSchema.safeParse({ ...task, priority: "p1", blocked_by: ["tsk-3f9a1b2c"], due: "2026-11-01" })
        .success,
    ).toBe(true);
    expect(recordSchema.safeParse({ ...task, priority: "p4" }).success).toBe(false);
    const mem = minimal("memory", "mem", "active");
    expect(recordSchema.safeParse(mem).success).toBe(true); // kind is optional
    expect(recordSchema.safeParse({ ...mem, kind: "gotcha" }).success).toBe(true);
    expect(recordSchema.safeParse({ ...mem, kind: "rumour" }).success).toBe(false);
    const inc = minimal("incident", "inc", "resolved");
    expect(recordSchema.safeParse({ ...inc, severity: "sev2" }).success).toBe(true);
    expect(recordSchema.safeParse({ ...inc, severity: "sev5" }).success).toBe(false);
  });

  it("does not inject defaults (e.g. task priority)", () => {
    const out = recordSchema.parse(minimal("task", "tsk", "open"));
    expect(out).not.toHaveProperty("priority");
  });

  it("requires source when managed_by is external", () => {
    const fm = { ...minimal("decision", "dec", "accepted"), managed_by: "external" };
    expect(baseFrontmatterSchema.safeParse(fm).success).toBe(false);
    expect(recordSchema.safeParse({ ...fm, source: validSource }).success).toBe(true);
    expect(recordSchema.safeParse({ ...fm, source: { ...validSource, system: "dropbox" } }).success).toBe(
      false,
    );
    expect(recordSchema.safeParse({ ...fm, source: { ...validSource, state: "gone" } }).success).toBe(false);
  });

  it("validates external links", () => {
    const fm = minimal("task", "tsk", "open");
    expect(
      recordSchema.safeParse({ ...fm, external: [{ system: "jira", id: "ABC-12", url: "https://x/ABC-12" }] })
        .success,
    ).toBe(true);
    expect(recordSchema.safeParse({ ...fm, external: [{ id: "ABC-12" }] }).success).toBe(false);
  });

  it("preserves unknown keys at top level and inside nested objects", () => {
    const fm = {
      ...minimal("decision", "dec", "accepted"),
      managed_by: "external",
      source: { ...validSource, future_field: 1 },
      x_custom: { a: [1, 2] },
    };
    const out = recordSchema.parse(fm);
    expect(out).toEqual(fm);
    expect(Object.keys(out)).toEqual(Object.keys(fm));
  });
});
