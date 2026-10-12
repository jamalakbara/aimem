import { parseRecordText, serializeRecord } from "@aimem/core";
import { describe, expect, it } from "vitest";
import { fixtureRecordFiles, read } from "./helpers.js";

const ok = (text: string) => {
  const r = parseRecordText(text);
  if (!r.ok) throw new Error(r.message);
  return r.record;
};

const SAMPLE = `---
aimem: 1
id: mem-0123abcd
type: memory
title: A title
summary: "Done: x · Next: y"
status: active
trust: agent
roles: [dev]
author: agent:claude-code
created: 2026-10-01T09:00:00Z
updated: 2026-10-01T09:00:00Z
---

Body text.
`;

describe("parseRecordText", () => {
  it("splits frontmatter data and body", () => {
    const rec = ok(SAMPLE);
    expect(rec.data.id).toBe("mem-0123abcd");
    expect(rec.data.summary).toBe("Done: x · Next: y");
    expect(rec.data.created).toBe("2026-10-01T09:00:00Z"); // timestamps stay strings
    expect(rec.body).toBe("Body text.");
  });

  it.each([
    ["no frontmatter", "# Just markdown\n"],
    ["unterminated frontmatter", "---\nid: x\n\nbody\n"],
    ["invalid YAML", "---\nroles: [dev, qa\n---\n\nbody\n"],
    ["frontmatter is a list", "---\n- a\n- b\n---\n\nbody\n"],
    ["frontmatter is a scalar", "---\nhello\n---\n\nbody\n"],
    ["duplicate keys", "---\nid: a\nid: b\n---\n\nbody\n"],
  ])("reports V001 for %s", (_name, text) => {
    const r = parseRecordText(text);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("V001");
      expect(r.message.length).toBeGreaterThan(0);
    }
  });

  it("accepts CRLF and a BOM, and normalises output to LF without BOM", () => {
    const crlf = `﻿${SAMPLE.replace(/\n/g, "\r\n")}`;
    const rec = ok(crlf);
    expect(rec.data.title).toBe("A title");
    expect(rec.body).toBe("Body text.");
    expect(serializeRecord(rec)).toBe(SAMPLE);
  });

  it("allows an empty body", () => {
    const rec = ok("---\nid: x\n---\n");
    expect(rec.body).toBe("");
  });
});

describe("no data loss: unchanged records rewrite byte-for-byte", () => {
  const files = [
    ...fixtureRecordFiles("tiny"),
    ...fixtureRecordFiles("medium"),
    ...fixtureRecordFiles("messy"),
  ];

  it("covers the fixtures", () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it.each(files.map((f) => [f.split("/fixtures/projects/")[1] as string, f]))("%s", (_rel, file) => {
    const text = read(file);
    const r = parseRecordText(text);
    if (!r.ok) {
      expect(r.code).toBe("V001"); // the broken messy files
      return;
    }
    expect(serializeRecord(r.record)).toBe(text);
  });
});
