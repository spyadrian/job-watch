import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 8787);

// Runs against the real built app (vite build + node server) with Sources served
// from tests/fixtures/e2e-sources.json and a fresh in-memory database per server start.
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && node src/server/main.ts",
    url: `http://127.0.0.1:${port}/api/jobs`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(port),
      HOST: "127.0.0.1",
      JOB_WATCH_DB: ":memory:",
      JOB_WATCH_RECORDED_SOURCES: "tests/fixtures/e2e-sources.json",
    },
  },
});
