import { hash, verify } from "@node-rs/argon2";
import { and, eq, gt, isNull } from "drizzle-orm";
import { env } from "@/config/env";
import { policy } from "@/config/policy";
import type { Db } from "@/db/client";
import { adminLoginAttempts, adminSessions } from "@/db/schema";
import { randomToken, safeEqualHex, sha256Hex } from "@/lib/crypto";
import { hitRateLimit, resetRateLimit } from "@/lib/rate-limit";

/**
 * Single-admin authentication: ADMIN_EMAIL + ADMIN_PASSWORD_HASH (argon2id) from
 * the environment, DB-backed sessions (only the SHA-256 of the cookie token is
 * stored), and failed-login rate limiting per IP and per email.
 */

export const MIN_ADMIN_PASSWORD_LENGTH = 12;

/** argon2id with the library defaults (m=19456 KiB, t=2, p=1; OWASP baseline). */
export async function hashAdminPassword(password: string): Promise<string> {
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new Error(`Admin password must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`);
  }
  return hash(password);
}

/** Next.js expands `$` in .env values, so hashes are stored as `\$argon2id\$...`. */
export function escapeHashForDotenv(passwordHash: string): string {
  return passwordHash.replace(/\$/g, "\\$");
}

export function normalizePasswordHash(raw: string): string {
  return raw.replace(/\\\$/g, "$");
}

export interface AdminConfig {
  email: string;
  passwordHash: string;
}

export function getAdminConfig(): AdminConfig | null {
  const { ADMIN_EMAIL, ADMIN_PASSWORD_HASH } = env();
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD_HASH) return null;
  return { email: ADMIN_EMAIL, passwordHash: normalizePasswordHash(ADMIN_PASSWORD_HASH) };
}

export type LoginResult =
  | { ok: true; sessionToken: string; expiresAt: Date }
  | { ok: false; reason: "invalid_credentials" | "not_configured" }
  | { ok: false; reason: "rate_limited"; retryAt: Date };

/** RFC 5321 path limit; longer input is rejected before touching the database. */
export const MAX_LOGIN_EMAIL_LENGTH = 254;
export const MAX_LOGIN_PASSWORD_LENGTH = 1024;

export async function loginAdmin(
  db: Db,
  input: {
    email: string;
    password: string;
    ip?: string | null;
    userAgent?: string | null;
    now?: Date;
    config?: AdminConfig | null;
  },
): Promise<LoginResult> {
  const config = input.config === undefined ? getAdminConfig() : input.config;
  if (!config) return { ok: false, reason: "not_configured" };

  const email = input.email.trim().toLowerCase();
  // Oversized input can never match; refusing it here keeps it out of every table.
  if (email.length > MAX_LOGIN_EMAIL_LENGTH || input.password.length > MAX_LOGIN_PASSWORD_LENGTH) {
    return { ok: false, reason: "invalid_credentials" };
  }

  const now = input.now ?? new Date();
  const { maxFailuresPerWindow, windowSeconds } = policy.adminLogin;
  // The IP bucket applies only when the IP comes from a trusted proxy.
  const keys = [`admin-login:email:${email}`, ...(input.ip ? [`admin-login:ip:${input.ip}`] : [])];

  // Count the attempt atomically BEFORE the (slow) password check, so a burst of
  // parallel guesses cannot all pass a read-only check; success clears the count.
  let retryAt: Date | null = null;
  for (const key of keys) {
    const state = await hitRateLimit(db, key, maxFailuresPerWindow, windowSeconds, now);
    if (!state.allowed && (!retryAt || state.resetAt > retryAt)) retryAt = state.resetAt;
  }
  if (retryAt) {
    await recordAttempt(db, email, input.ip, false, now);
    return { ok: false, reason: "rate_limited", retryAt };
  }

  const emailMatches = safeEqualHex(sha256Hex(email), sha256Hex(config.email.trim().toLowerCase()));
  // Always run the password check so timing does not reveal whether the email matched.
  let passwordMatches = false;
  try {
    passwordMatches = await verify(config.passwordHash, input.password);
  } catch {
    passwordMatches = false;
  }

  const success = emailMatches && passwordMatches;
  await recordAttempt(db, email, input.ip, success, now);
  if (!success) return { ok: false, reason: "invalid_credentials" };

  for (const key of keys) await resetRateLimit(db, key);
  const session = await createAdminSession(db, { ip: input.ip, userAgent: input.userAgent, now });
  return { ok: true, sessionToken: session.token, expiresAt: session.expiresAt };
}

async function recordAttempt(db: Db, email: string, ip: string | null | undefined, success: boolean, now: Date) {
  await db.insert(adminLoginAttempts).values({ email, ip: ip ?? null, success, createdAt: now });
}

export async function createAdminSession(
  db: Db,
  input: { ip?: string | null; userAgent?: string | null; now?: Date },
): Promise<{ token: string; expiresAt: Date }> {
  const now = input.now ?? new Date();
  const token = randomToken(32);
  const expiresAt = new Date(now.getTime() + policy.adminLogin.sessionTtlDays * 86_400_000);
  await db.insert(adminSessions).values({
    tokenHash: sha256Hex(token),
    expiresAt,
    ip: input.ip ?? null,
    userAgent: input.userAgent?.slice(0, 500) ?? null,
    lastSeenAt: now,
    createdAt: now,
  });
  return { token, expiresAt };
}

export async function getAdminSession(db: Db, token: string, now: Date = new Date()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [session] = await db
    .update(adminSessions)
    .set({ lastSeenAt: now })
    .where(
      and(
        eq(adminSessions.tokenHash, sha256Hex(token)),
        isNull(adminSessions.revokedAt),
        gt(adminSessions.expiresAt, now),
      ),
    )
    .returning({ id: adminSessions.id, expiresAt: adminSessions.expiresAt });
  return session ?? null;
}

export async function revokeAdminSession(db: Db, token: string, now: Date = new Date()): Promise<void> {
  await db.update(adminSessions).set({ revokedAt: now }).where(eq(adminSessions.tokenHash, sha256Hex(token)));
}
