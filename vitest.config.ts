import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    testTimeout: 30000,
    globalSetup: ["./vitest.global-setup.ts"],
  },
  resolve: {
    alias: {
      "@aimem/schema": new URL("./packages/schema/src/index.ts", import.meta.url).pathname,
      "@aimem/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@aimem/adapters": new URL("./packages/adapters/src/index.ts", import.meta.url).pathname,
      aimem: new URL("./packages/cli/src/index.ts", import.meta.url).pathname,
    },
  },
});
