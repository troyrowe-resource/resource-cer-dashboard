import { defineConfig, devices } from "@playwright/test";

/* Playwright end-to-end config. Run with: npm run test:e2e
   (first time on a machine: `npm i -D @playwright/test @axe-core/playwright`
   is already in devDependencies, then `npx playwright install chromium`).
   The webServer builds and serves the production app, so the data pipeline
   (prebuild -> build:data) runs first, exactly like Vercel. */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  outputDir: "./test-screenshots/.artifacts",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
  },
});
