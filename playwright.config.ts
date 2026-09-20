import { defineConfig, devices } from "@playwright/test";

// Safety net before the TS rewrite: the tests boot up the deployed page, not a
// copy of it. Hence Chromium only — this is about behavior, not browser
// diversity.

// Normally the suite brings its own `astro dev`. PW_BASE_URL points it at a
// server that is already running instead — that's how the production bundle gets
// tested: `astro build && astro preview`, then run against that port.
const external = process.env.PW_BASE_URL;
const baseURL = external ?? "http://localhost:4321";

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
    baseURL,
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
  webServer: external
    ? undefined
    : {
        command: "ocx exec -- pnpm exec astro dev --host",
        url: `${baseURL}/planner`,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
