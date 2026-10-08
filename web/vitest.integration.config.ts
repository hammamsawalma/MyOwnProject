import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Integration tests: real PostgreSQL (start it with `pnpm db:start`).
const containerChromium = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/integration/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/studio_test",
      APP_SECRET: "integration-test-secret-0123456789-abcdefghij",
      APP_BASE_URL: "http://localhost:3000",
      SALES_ENABLED: "false",
      BUSINESS_TIMEZONE: "Europe/Istanbul",
      STORAGE_DIR: path.join(os.tmpdir(), "studio-web-test-storage"),
      CHROMIUM_PATH: process.env.CHROMIUM_PATH ?? (existsSync(containerChromium) ? containerChromium : ""),
    },
  },
});
