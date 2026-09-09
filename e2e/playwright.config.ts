import { defineConfig, devices } from "@playwright/test";
import { ADMIN_STATE, ADMIN_URL, WEB_STATE, WEB_URL } from "./support/fixture";

/**
 * End-to-end against the running stack — the real API, the real database, the real media host.
 *
 * This is deliberately not the same thing as `apps/web/e2e`, which stubs the API and exists to catch
 * rendering regressions in CI without a database. Everything here goes through the actual backend, so a
 * broken serialiser, a missing migration or a route that 500s under real data shows up as a failure rather
 * than passing against a mock that was written to match the code as it was.
 *
 * Servers are expected to be up already (`pnpm dev` plus the API): starting them from here would mean this
 * suite owns the ports, and running it would knock over whatever the developer had running.
 */
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  // Not fully parallel: the whole suite drives one seeded viewer account and one admin account against one
  // database. Two tests running at once means one claiming a daily reward while another asserts the balance
  // after a purchase, and the arithmetic stops being checkable. Files still run in parallel across projects;
  // it is the tests inside a project that are ordered.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 45_000,
  expect: { timeout: 12_000 },
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "setup", testMatch: /global\.setup\.ts/ },
    {
      name: "web",
      dependencies: ["setup"],
      testDir: "./web",
      use: { ...devices["Desktop Chrome"], baseURL: WEB_URL, storageState: WEB_STATE },
    },
    {
      // Signed out on purpose: the guest paths (locked episodes, sign-in prompts, SEO) are a different
      // product than the signed-in ones and regress independently.
      name: "web-guest",
      dependencies: ["setup"],
      testDir: "./web-guest",
      use: { ...devices["Desktop Chrome"], baseURL: WEB_URL },
    },
    {
      name: "admin",
      dependencies: ["setup"],
      testDir: "./admin",
      use: { ...devices["Desktop Chrome"], baseURL: ADMIN_URL, storageState: ADMIN_STATE },
    },
  ],
});
