import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests: pure logic, no database.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    env: {
      NODE_ENV: "test",
      APP_SECRET: "unit-test-secret-unit-test-secret-0123456789",
      BUSINESS_TIMEZONE: "Europe/Istanbul",
    },
  },
});
