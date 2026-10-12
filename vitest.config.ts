import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["packages/*/test/**/*.test.ts"], testTimeout: 30000 },
  resolve: {
    alias: {
      "@aimem/schema": new URL("./packages/schema/src/index.ts", import.meta.url).pathname,
      "@aimem/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
    },
  },
});
