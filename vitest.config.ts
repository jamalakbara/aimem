import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    testTimeout: 30000,
    // Real-Git fixture setup in beforeEach can exceed the 10 s default on hosted Windows runners.
    hookTimeout: 30000,
    // Bound concurrent fixture I/O on hosted Windows runners.
    maxWorkers: 4,
    globalSetup: ["./vitest.global-setup.ts"],
  },
  resolve: {
    alias: {
      "@aimem/schema": new URL("./packages/schema/src/index.ts", import.meta.url).pathname,
      "@aimem/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@aimem/adapters": new URL("./packages/adapters/src/index.ts", import.meta.url).pathname,
      "@aimem/mcp": new URL("./packages/mcp/src/index.ts", import.meta.url).pathname,
      aimem: new URL("./packages/cli/src/index.ts", import.meta.url).pathname,
    },
  },
});
