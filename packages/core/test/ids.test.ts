import { newId, newUniqueId, recordFileName, slugify } from "@aimem/core";
import { ID_ALPHABET, isValidId, RECORD_TYPES, TYPE_PREFIX } from "@aimem/schema";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fixedRandom } from "./helpers.js";

describe("ids (03 §2.2)", () => {
  it("maps random bytes onto the Crockford alphabet with the type prefix", () => {
    expect(newId("decision", fixedRandom(0, 1, 2, 3, 31, 32, 33, 255))).toBe("dec-0123z01z");
  });

  it("always produces a valid id for every type", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...RECORD_TYPES),
        fc.uint8Array({ minLength: 8, maxLength: 8 }),
        (t, bytes) => {
          const id = newId(t, { bytes: () => bytes });
          expect(isValidId(id)).toBe(true);
          expect(id.startsWith(`${TYPE_PREFIX[t]}-`)).toBe(true);
        },
      ),
    );
    expect(ID_ALPHABET).toHaveLength(32);
  });

  it("retries on collision", () => {
    const taken = new Set(["mem-00000000"]);
    expect(newUniqueId("memory", fixedRandom(0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1), taken)).toBe(
      "mem-11111111",
    );
  });

  it("gives up after repeated collisions instead of looping forever", () => {
    expect(() => newUniqueId("memory", fixedRandom(0), new Set(["mem-00000000"]))).toThrow(/unique id/);
  });
});

describe("slugify (03 §2)", () => {
  it.each([
    ["Use Postgres for the ledger", "use-postgres-for-the-ledger"],
    ["  Spaces & Symbols!!  ", "spaces-symbols"],
    ["Café déjà vu", "cafe-deja-vu"],
    ["Anggaran token dihitung dengan chars/4", "anggaran-token-dihitung-dengan-chars-4"],
    ["🚀🚀", "untitled"],
    ["数据库", "untitled"],
    ["", "untitled"],
  ])("%j → %s", (title, slug) => {
    expect(slugify(title)).toBe(slug);
  });

  it("caps at 60 characters without a trailing hyphen", () => {
    const s = slugify(`${"abcde ".repeat(20)}`);
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith("-")).toBe(false);
  });

  it("only ever produces a-z0-9 and single hyphens", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (t) => {
        const s = slugify(t);
        expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(s.length).toBeLessThanOrEqual(60);
      }),
    );
  });
});

describe("recordFileName", () => {
  it("is <id>-<slug>.md", () => {
    expect(
      recordFileName({
        id: "dec-7k3m9q2x",
        type: "decision",
        title: "Use Postgres",
        created: "2026-10-08T07:12:00Z",
      }),
    ).toBe("dec-7k3m9q2x-use-postgres.md");
  });
  it("adds the creation date for handoffs", () => {
    expect(
      recordFileName({
        id: "hnd-7g8h9j0k",
        type: "handoff",
        title: "Migration done",
        created: "2026-10-05T17:40:00Z",
      }),
    ).toBe("hnd-7g8h9j0k-20261005-migration-done.md");
  });
});
