import {
  ID_ALPHABET,
  isValidId,
  RECORD_TYPES,
  recordSchema,
  STATUSES,
  TRUST_LEVELS,
  TYPE_PREFIX,
} from "@aimem/schema";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

const iso = fc
  .date({ min: new Date("2000-01-01T00:00:00Z"), max: new Date("2099-12-31T23:59:59Z"), noInvalidDate: true })
  .map((d) => `${d.toISOString().slice(0, 19)}Z`);
const day = iso.map((s) => s.slice(0, 10));
const idChars = fc.string({ unit: fc.constantFrom(...ID_ALPHABET), minLength: 8, maxLength: 8 });
const handle = fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/);
const tag = fc.stringMatching(/^[a-z0-9]+(-[a-z0-9]+)*$/);
/** JSON-safe values (no -0, no undefined), as they would come out of YAML/JSON. */
const jsonValue = fc.json().map((s) => JSON.parse(s) as unknown);
const unknownKeys = fc.dictionary(fc.stringMatching(/^x_[a-z_]{1,10}$/), jsonValue, { maxKeys: 4 });

const frontmatter = fc
  .constantFrom(...RECORD_TYPES)
  .chain((type) =>
    fc.record(
      {
        aimem: fc.constant(1),
        id: idChars.map((s) => `${TYPE_PREFIX[type]}-${s}`),
        type: fc.constant(type),
        title: fc.string({ minLength: 1, maxLength: 120 }),
        summary: fc.string({ minLength: 1, maxLength: 200 }),
        status: fc.constantFrom(...STATUSES[type]),
        trust: fc.constantFrom(...TRUST_LEVELS),
        roles: fc.array(fc.constantFrom("dev", "pm", "qa", "all"), { minLength: 1, maxLength: 3 }),
        tags: fc.array(tag, { maxLength: 3 }),
        paths: fc.array(fc.constantFrom("src/**", "db/migrations/**", "README.md"), { maxLength: 2 }),
        author: fc.oneof(
          handle.map((h) => `human:${h}`),
          handle.map((h) => `agent:${h}`),
        ),
        created: iso,
        updated: iso,
        verified: day,
        links: fc.array(
          idChars.map((s) => `mem-${s}`),
          { maxLength: 3 },
        ),
      },
      {
        requiredKeys: [
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
        ],
      },
    ),
  )
  .chain((fm) => unknownKeys.map((extra) => ({ ...extra, ...fm })));

describe("schema round-trip properties (12 §1)", () => {
  it("every generated valid frontmatter parses, and parsing is idempotent", () => {
    fc.assert(
      fc.property(frontmatter, (fm) => {
        const once = recordSchema.parse(fm);
        expect(recordSchema.parse(once)).toEqual(once);
      }),
    );
  });

  it("unknown keys and their values are preserved", () => {
    fc.assert(
      fc.property(frontmatter, (fm) => {
        expect(recordSchema.parse(fm)).toEqual(fm);
      }),
    );
  });

  it("JSON serialize → parse yields an equal record", () => {
    fc.assert(
      fc.property(frontmatter, (fm) => {
        const out = recordSchema.parse(fm);
        expect(recordSchema.parse(JSON.parse(JSON.stringify(out)))).toEqual(out);
      }),
    );
  });

  it("isValidId accepts exactly <known prefix>-<8 alphabet chars>", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 16 }), (s) => {
        const expected = RECORD_TYPES.some((t) => {
          const p = `${TYPE_PREFIX[t]}-`;
          return (
            s.startsWith(p) &&
            s.length === p.length + 8 &&
            [...s.slice(p.length)].every((c) => ID_ALPHABET.includes(c))
          );
        });
        expect(isValidId(s)).toBe(expected);
      }),
    );
    fc.assert(
      fc.property(fc.constantFrom(...RECORD_TYPES), idChars, (t, s) => isValidId(`${TYPE_PREFIX[t]}-${s}`)),
    );
  });
});
