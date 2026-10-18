import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Next keeps `jsx: preserve` in tsconfig, so tell esbuild to compile JSX itself (and avoid the plugin-react/vite type clash).
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.d.ts"],
      reporter: ["text", "text-summary", "json-summary"],
      // Enforced, not just reported: coverage that is measured but not gated drifts.
      thresholds: { statements: 95, branches: 95, functions: 95, lines: 95 },
    },
  },
});
