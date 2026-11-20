import { normalizeClaimPaths, pathsOverlap, staticPrefix } from "@aimem/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

describe("normalizeClaimPaths", () => {
  it("trims, converts backslashes and removes duplicates in order", () => {
    expect(normalizeClaimPaths([" src/api/** ", "db\\migrations\\*.sql", "src/api/**"])).toEqual([
      "src/api/**",
      "db/migrations/*.sql",
    ]);
  });

  it.each([
    ["empty entry", [" "]],
    ["absolute path", ["/etc/passwd"]],
    ["drive letter", ["C:/repo/src"]],
    ["parent segment", ["../other"]],
    ["inner parent segment", ["src/../secrets"]],
    ["leading ./", ["./src"]],
    ["empty segment", ["src//api"]],
    ["control character", ["src/\u0007api"]],
    ["too long", [`src/${"a".repeat(253)}`]],
    ["too many entries", Array.from({ length: 33 }, (_, i) => `p${i}`)],
    ["no entries", []],
  ])("rejects %s with USAGE", (_name, paths) => {
    expect(() => normalizeClaimPaths(paths)).toThrow(expect.objectContaining({ code: "USAGE" }));
  });

  it("accepts the documented limits", () => {
    expect(normalizeClaimPaths([`src/${"a".repeat(252)}`])).toHaveLength(1);
    expect(normalizeClaimPaths(Array.from({ length: 32 }, (_, i) => `p${i}`))).toHaveLength(32);
  });
});

describe("pathsOverlap", () => {
  it.each([
    ["src/api", "src/api/routes.ts", true],
    ["src/api/**", "src/api/routes.ts", true],
    ["src/api", "src/api-v2/routes.ts", false],
    ["docs/**", "src/**", false],
    ["**", "anything/at/all.ts", true],
    ["src/*.ts", "src/deep/file.ts", true],
    ["services/webhooks/**", "services/billing/**", false],
  ])("%s and %s overlap: %s", (a, b, expected) => {
    expect(pathsOverlap(a, b)).toBe(expected);
    expect(pathsOverlap(b, a)).toBe(expected);
  });

  it("takes static segments before the first wildcard segment", () => {
    expect(staticPrefix("src/{a,b}/x.ts")).toEqual(["src"]);
    expect(staticPrefix("src/api/routes.ts")).toEqual(["src", "api", "routes.ts"]);
  });

  it("is symmetric, reflexive and covers every descendant", () => {
    const segment = fc.stringMatching(/^[a-z][a-z0-9-]{0,5}$/);
    const path = fc.array(segment, { minLength: 1, maxLength: 4 }).map((parts) => parts.join("/"));
    fc.assert(
      fc.property(path, path, fc.array(segment, { maxLength: 3 }), (a, b, tail) => {
        expect(pathsOverlap(a, b)).toBe(pathsOverlap(b, a));
        expect(pathsOverlap(a, a)).toBe(true);
        expect(pathsOverlap(a, [a, ...tail].join("/"))).toBe(true);
        expect(pathsOverlap(`${a}/**`, [a, ...tail, "x.ts"].join("/"))).toBe(true);
      }),
    );
  });
});
