import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests run against a production build (`next start`) pointed at `e2e/mock-api.mjs`.
 * `NEXT_PUBLIC_*` values are baked in at build time, so the build runs inside the web server command
 * with the mock's URL in the environment.
 */
const API_PORT = Number(process.env.MOCK_API_PORT ?? 8787);
const WEB_PORT = Number(process.env.E2E_PORT ?? 3100);

export const API_URL = `http://localhost:${API_PORT}`;
export const SITE_URL = `http://localhost:${WEB_PORT}`;

const webEnv = {
  NEXT_PUBLIC_API_URL: API_URL,
  NEXT_PUBLIC_SITE_URL: SITE_URL,
  NEXT_PUBLIC_MEDIA_ORIGINS: API_URL,
  NEXT_PUBLIC_ADS_TXT: "google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0",
  NEXT_PUBLIC_INDEXNOW_KEY: "katha-e2e-indexnow-key",
  NEXT_TELEMETRY_DISABLED: "1",
};

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: SITE_URL,
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `node e2e/mock-api.mjs --port ${API_PORT}`,
      url: `${API_URL}/health`,
      reuseExistingServer: !process.env.CI,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `pnpm run build && pnpm run start --port ${WEB_PORT}`,
      url: SITE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
      env: webEnv,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
