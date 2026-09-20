import { defineConfig } from "vitest/config";

// ponytail: nur tests/unit — tests/e2e sind Playwright-Specs (eigenes
// beforeEach/fixtures aus @playwright/test) und laufen über `task test:e2e`,
// nicht über vitest.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
