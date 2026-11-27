import { defineConfig } from "vitest/config";
import base from "./vitest.config.js";

/**
 * Server tests that need PostgreSQL (plan 6.1 §7.2). Run only by the CI job `server`, which provides
 * `AIMEM_TEST_DATABASE_URL`; without it every test file fails instead of skipping.
 */
export default defineConfig({
  ...(base.resolve ? { resolve: base.resolve } : {}),
  test: {
    include: ["packages/server/test/db/**/*.test.ts"],
    retry: 0,
    maxWorkers: 2,
    testTimeout: 120_000,
    hookTimeout: 60_000,
    globalSetup: ["./vitest.global-setup.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
