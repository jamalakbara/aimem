import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests of the local viewer (24 §5.8). They start the built CLI, so run `pnpm test:e2e`, which builds
 * first. The time budget is its own project with one worker: `pnpm test:budget`.
 */
export default defineConfig({
  testDir: "packages/viewer/test/e2e",
  outputDir: "test-results",
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 2,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "chromium", testMatch: "*.spec.ts", use: { ...devices["Desktop Chrome"] } },
    { name: "budget", testMatch: "*.budget.ts", use: { ...devices["Desktop Chrome"] } },
  ],
});
