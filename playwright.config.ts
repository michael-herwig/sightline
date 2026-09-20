import { defineConfig, devices } from "@playwright/test";

// Safety net before the TS rewrite: the tests boot up the deployed page, not a
// copy of it. Hence Chromium only — this is about behavior, not browser
// diversity.
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry, so `trace: on-first-retry` actually records something.
  retries: 1,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:4321",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      // Fixed viewport after the spread: grouping and the tile grid depend on the
      // screen size, and `devices` brings its own.
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1400, height: 900 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: {
    command: "ocx exec -- pnpm exec astro dev --host",
    url: "http://localhost:4321/planner",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
