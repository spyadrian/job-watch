import { defineConfig } from "vitest/config";

// API (tests/api) and job-list (tests/job-list) suites; Playwright specs live in tests/e2e.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
