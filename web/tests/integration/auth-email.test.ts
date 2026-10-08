import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/config/env";
import { policy } from "@/config/policy";
import { adminLoginAttempts, emailOutbox, rateLimits } from "@/db/schema";
import {
  escapeHashForDotenv,
  getAdminSession,
  hashAdminPassword,
  loginAdmin,
  normalizePasswordHash,
  revokeAdminSession,
  type AdminConfig,
} from "@/lib/auth/admin";
import { deliverEmail, EmailNotConfiguredError, sendEmail } from "@/lib/email/send";
import { openTestDb, resetDatabase } from "./helpers";

const handle = openTestDb();
const { db } = handle;
const password = "correct horse battery staple";
let config: AdminConfig;

beforeAll(async () => {
  config = { email: "Founder@Example.com", passwordHash: await hashAdminPassword(password) };
});
beforeEach(() => resetDatabase(handle));
afterAll(() => handle.close());

describe("admin auth", () => {
  it("hashes with argon2id and survives .env escaping", async () => {
    expect(config.passwordHash).toMatch(/^\$argon2id\$v=19\$/);
    const escaped = escapeHashForDotenv(config.passwordHash);
    expect(escaped).not.toMatch(/(^|[^\\])\$/);
    expect(normalizePasswordHash(escaped)).toBe(config.passwordHash);
    await expect(hashAdminPassword("short")).rejects.toThrow();
  });

  it("logs in with the right credentials (email case-insensitive) and manages sessions", async () => {
    const result = await loginAdmin(db, { email: "founder@example.com", password, ip: "192.0.2.1", config });
    if (!result.ok) throw new Error(`login failed: ${result.reason}`);
    expect(result.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await getAdminSession(db, result.sessionToken)).not.toBeNull();
    expect(await getAdminSession(db, "x".repeat(43))).toBeNull();
    await revokeAdminSession(db, result.sessionToken);
    expect(await getAdminSession(db, result.sessionToken)).toBeNull();

    const later = new Date(Date.now() + (policy.adminLogin.sessionTtlDays + 1) * 86_400_000);
    const second = await loginAdmin(db, { email: "founder@example.com", password, config });
    if (!second.ok) throw new Error("second login failed");
    expect(await getAdminSession(db, second.sessionToken, later)).toBeNull();
  });

  it("rejects wrong credentials and rate limits after repeated failures", async () => {
    expect(await loginAdmin(db, { email: "other@example.com", password, ip: "192.0.2.2", config })).toEqual({
      ok: false,
      reason: "invalid_credentials",
    });
    for (let i = 1; i < policy.adminLogin.maxFailuresPerWindow; i++) {
      await loginAdmin(db, { email: "founder@example.com", password: "wrong", ip: "192.0.2.2", config });
    }
    const blocked = await loginAdmin(db, { email: "founder@example.com", password, ip: "192.0.2.2", config });
    expect(blocked).toMatchObject({ ok: false, reason: "rate_limited" });
    const attempts = await db.select().from(adminLoginAttempts).where(eq(adminLoginAttempts.ip, "192.0.2.2"));
    expect(attempts.filter((a) => !a.success)).toHaveLength(policy.adminLogin.maxFailuresPerWindow + 1);
  });

  it("counts parallel guesses atomically: a burst cannot exceed the limit", async () => {
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        loginAdmin(db, { email: "founder@example.com", password: "wrong guess", ip: "192.0.2.3", config }),
      ),
    );
    const checked = results.filter((r) => !r.ok && r.reason === "invalid_credentials");
    expect(checked.length).toBeLessThanOrEqual(policy.adminLogin.maxFailuresPerWindow);
    expect(results.filter((r) => !r.ok && r.reason === "rate_limited").length).toBe(30 - checked.length);
  });

  it("clears the failure count after a successful login", async () => {
    for (let i = 1; i < policy.adminLogin.maxFailuresPerWindow; i++) {
      await loginAdmin(db, { email: "founder@example.com", password: "wrong", ip: "192.0.2.4", config });
    }
    expect((await loginAdmin(db, { email: "founder@example.com", password, ip: "192.0.2.4", config })).ok).toBe(true);
    const again = await loginAdmin(db, { email: "founder@example.com", password: "wrong", ip: "192.0.2.4", config });
    expect(again).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("refuses oversized input before storing anything", async () => {
    const huge = `${"a".repeat(300_000)}@example.com`;
    expect(await loginAdmin(db, { email: huge, password, ip: "192.0.2.5", config })).toEqual({
      ok: false,
      reason: "invalid_credentials",
    });
    expect(await loginAdmin(db, { email: "founder@example.com", password: "p".repeat(5_000), config })).toEqual({
      ok: false,
      reason: "invalid_credentials",
    });
    expect(await db.select().from(adminLoginAttempts)).toHaveLength(0);
    expect(await db.select().from(rateLimits)).toHaveLength(0);
  });

  it("reports when the admin is not configured", async () => {
    expect(await loginAdmin(db, { email: "a@b.co", password, config: null })).toEqual({ ok: false, reason: "not_configured" });
  });
});

describe("email", () => {
  const savedNodeEnv = process.env.NODE_ENV;
  const setNodeEnv = (value: string | undefined) => {
    (process.env as Record<string, string | undefined>).NODE_ENV = value;
    resetEnvCache();
  };
  afterEach(() => setNodeEnv(savedNodeEnv));

  it("logs to the dev outbox without an API key", async () => {
    const result = await sendEmail(db, { to: "c@example.com", subject: "مرحبا", text: "نص" });
    expect(result.status).toBe("logged");
    const rows = await db.select().from(emailOutbox);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ toEmail: "c@example.com", subject: "مرحبا", provider: "console" });
  });

  it("sends through the Resend HTTP API when a key is set", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ id: "msg_123" }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await sendEmail(
      db,
      { to: "c@example.com", subject: "Hi", text: "Body", tag: "otp" },
      { apiKey: "re_test", fetchImpl: fakeFetch, from: "Studio <no-reply@example.com>" },
    );
    expect(result).toEqual({ status: "sent", provider: "resend", providerMessageId: "msg_123" });
    expect(captured?.url).toBe("https://api.resend.com/emails");
    expect((captured?.init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect(JSON.parse(String(captured?.init.body))).toMatchObject({ to: ["c@example.com"], subject: "Hi", text: "Body" });
    expect(await db.select().from(emailOutbox)).toHaveLength(0);

    const failing = (async () => new Response("bad", { status: 422 })) as unknown as typeof fetch;
    const failed = await sendEmail(db, { to: "c@example.com", subject: "Hi", text: "B" }, { apiKey: "k", fetchImpl: failing });
    expect(failed).toMatchObject({ status: "failed", provider: "resend" });
  });

  it("deliverEmail throws email_failed when the provider rejects the message", async () => {
    const failing = (async () => new Response("domain not verified", { status: 403 })) as unknown as typeof fetch;
    const original = console.error;
    const logged: string[] = [];
    console.error = (line: string) => void logged.push(line);
    try {
      await expect(
        deliverEmail(db, { to: "c@example.com", subject: "x", text: "code 123456" }, { apiKey: "k", fetchImpl: failing }),
      ).rejects.toMatchObject({ code: "email_failed" });
    } finally {
      console.error = original;
    }
    expect(logged.join("\n")).toContain("HTTP 403");
    expect(logged.join("\n")).not.toContain("123456");
  });

  it("refuses to log emails in production without an API key", async () => {
    setNodeEnv("production");
    await expect(sendEmail(db, { to: "c@example.com", subject: "x", text: "y" })).rejects.toBeInstanceOf(
      EmailNotConfiguredError,
    );
  });
});
