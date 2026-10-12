import { matchGlob } from "@aimem/core";
import { describe, expect, it } from "vitest";

describe("matchGlob", () => {
  it.each([
    ["services/webhooks/**", "services/webhooks/handler.ts", true],
    ["services/webhooks/**", "services/webhooks/deep/a/b.ts", true],
    ["services/webhooks/**", "services/webhooks", true],
    ["services/webhooks/**", "services/payments/x.ts", false],
    ["src/*.ts", "src/a.ts", true],
    ["src/*.ts", "src/a/b.ts", false],
    ["src/**/*.ts", "src/a/b/c.ts", true],
    ["src/**/*.ts", "src/c.ts", true],
    ["db/migrations/00?_init.sql", "db/migrations/001_init.sql", true],
    ["README.md", "README.md", true],
    ["README.md", "docs/README.md", false],
    ["a.b/c+d/(x)", "a.b/c+d/(x)", true],
  ])("%s ~ %s → %s", (glob, path, expected) => {
    expect(matchGlob(glob, path)).toBe(expected);
  });
});
