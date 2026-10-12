import { createRecord, deleteField, parseRecordText, serializeRecord, setBody, setField } from "@aimem/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

const TEXT = `---
aimem: 1
id: dec-0123abcd
type: decision
title: Keep comments
x_custom: { nested: [1, 2] }   # unknown key with a comment
summary: Edits must not disturb anything else.
status: proposed
# a standalone comment
trust: agent
roles: [dev, db]
author: agent:claude-code
created: 2026-10-01T09:00:00Z
updated: 2026-10-01T09:00:00Z
another_unknown: keep me
---

## Context
c

## Decision
d
`;

function parse(text: string) {
  const r = parseRecordText(text);
  if (!r.ok) throw new Error(r.message);
  return r.record;
}

describe("editing an existing record", () => {
  it("changes only the edited lines and keeps unknown keys, order and comments", () => {
    const rec = parse(TEXT);
    setField(rec, "status", "accepted");
    setField(rec, "updated", "2026-10-12T08:00:00Z");
    const out = serializeRecord(rec);
    const before = TEXT.split("\n");
    const after = out.split("\n");
    expect(after).toHaveLength(before.length);
    const changed = before.flatMap((l, i) => (l === after[i] ? [] : [[l, after[i]]]));
    expect(changed).toEqual([
      ["status: proposed", "status: accepted"],
      ["updated: 2026-10-01T09:00:00Z", "updated: 2026-10-12T08:00:00Z"],
    ]);
    expect(rec.data.status).toBe("accepted");
  });

  it("appends new keys at the end of the frontmatter", () => {
    const rec = parse(TEXT);
    setField(rec, "superseded_by", "dec-4567efgh");
    const out = serializeRecord(rec);
    expect(out).toContain("another_unknown: keep me\nsuperseded_by: dec-4567efgh\n---");
  });

  it("writes new list values in flow style like the rest of the file", () => {
    const rec = parse(TEXT);
    setField(rec, "links", ["tsk-3f9a1b2c", "mem-5e6f7g8h"]);
    expect(serializeRecord(rec)).toContain("links: [tsk-3f9a1b2c, mem-5e6f7g8h]\n");
  });

  it("deletes a key without touching others", () => {
    const rec = parse(TEXT);
    deleteField(rec, "another_unknown");
    const out = serializeRecord(rec);
    expect(out).not.toContain("another_unknown");
    expect(out).toContain("# a standalone comment");
    expect(rec.data).not.toHaveProperty("another_unknown");
  });

  it("replaces the body and keeps the frontmatter bytes", () => {
    const rec = parse(TEXT);
    setBody(rec, "\n\n## Context\nnew\n\n");
    const out = serializeRecord(rec);
    expect(out).toBe(`${TEXT.slice(0, TEXT.indexOf("---\n\n") + 4)}\n## Context\nnew\n`);
    expect(rec.body).toBe("## Context\nnew");
  });

  it("quotes values that would otherwise break or change type", () => {
    const rec = parse(TEXT);
    const tricky = {
      summary: "Done: x · Next: y",
      content_sha: "0000000000000000000000000000000000000000000000000000000000000000",
      title: "yes",
      x_number_like: "123",
      x_null_like: "null",
      x_hash: "# not a comment",
      x_leading_dash: "- not a list",
    };
    for (const [k, v] of Object.entries(tricky)) setField(rec, k, v);
    const back = parse(serializeRecord(rec));
    for (const [k, v] of Object.entries(tricky)) expect(back.data[k], k).toBe(v);
  });
});

describe("creating a new record", () => {
  const fields = {
    links: ["tsk-3f9a1b2c"],
    x_extra: "unknown keys go last",
    updated: "2026-10-12T08:00:00Z",
    created: "2026-10-12T08:00:00Z",
    author: "agent:claude-code",
    roles: ["dev"],
    trust: "agent",
    status: "active",
    summary: "Done: a · Next: b",
    title: "New note",
    type: "memory",
    id: "mem-0123abcd",
    aimem: 1,
  };

  it("writes known keys in canonical spec order, unknown keys after, lists in flow style, one blank line before the body", () => {
    const out = serializeRecord(createRecord(fields, "  Fact first.\n\nThen why.  \n"));
    expect(out).toBe(`---
aimem: 1
id: mem-0123abcd
type: memory
title: New note
summary: "Done: a · Next: b"
status: active
trust: agent
roles: [dev]
author: agent:claude-code
created: 2026-10-12T08:00:00Z
updated: 2026-10-12T08:00:00Z
links: [tsk-3f9a1b2c]
x_extra: unknown keys go last
---

Fact first.

Then why.
`);
  });

  it("never folds long lines", () => {
    const long = "word ".repeat(40).trim();
    const out = serializeRecord(createRecord({ ...fields, summary: long }, "b"));
    expect(out).toContain(`summary: ${long}\n`);
  });

  it("round-trips random frontmatter including unknown keys", () => {
    const scalar = fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null));
    const value = fc.oneof(
      scalar,
      fc.array(scalar, { maxLength: 3 }),
      fc.dictionary(fc.stringMatching(/^[a-z]{1,6}$/), scalar, { maxKeys: 3 }),
    );
    const fm = fc.dictionary(fc.stringMatching(/^[a-z_]{1,12}$/), value, { minKeys: 1, maxKeys: 8 });
    const body = fc.string().map((s) => s.trim());
    fc.assert(
      fc.property(fm, body, (data, b) => {
        const back = parseRecordText(serializeRecord(createRecord(data, b)));
        expect(back.ok).toBe(true);
        if (back.ok) {
          expect(back.record.data).toEqual(data);
          expect(back.record.body).toBe(b);
        }
      }),
    );
  });
});
