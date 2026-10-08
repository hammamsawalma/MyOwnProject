import { afterEach, describe, expect, it } from "vitest";
import { env, requireEnv, resetEnvCache } from "@/config/env";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
});

describe("env", () => {
  it("applies safe defaults", () => {
    delete process.env.MAGIC_LINK_TTL_DAYS;
    delete process.env.SALES_ENABLED;
    resetEnvCache();
    expect(env().MAGIC_LINK_TTL_DAYS).toBe(90);
    expect(env().SALES_ENABLED).toBe(false);
    expect(env().STORAGE_DIR).toBe("./storage");
  });

  it("requires variables only when they are used", () => {
    delete process.env.DATABASE_URL;
    resetEnvCache();
    expect(() => requireEnv("DATABASE_URL")).toThrow(/DATABASE_URL/);
  });

  it("rejects short secrets", () => {
    process.env.APP_SECRET = "short";
    resetEnvCache();
    expect(() => env()).toThrow(/APP_SECRET/);
  });
});
