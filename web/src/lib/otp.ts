import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { requireEnv } from "@/config/env";
import { policy } from "@/config/policy";
import type { Db } from "@/db/client";
import { otpCodes } from "@/db/schema";
import { hmacSha256Hex, randomDigits, safeEqualHex } from "./crypto";
import type { OtpPurpose } from "./domain-enums";
import { hitRateLimit } from "./rate-limit";

/**
 * One-time codes for sensitive client actions (accept quote, download final
 * deliverables): 6 digits sent by email, stored as HMAC-SHA256 keyed by
 * APP_SECRET (a plain hash of 6 digits is trivially brute-forced offline),
 * valid 10 minutes, at most 5 attempts, single use. Issuing a new code
 * invalidates the previous one for the same project and purpose.
 */

export function generateOtpCode(length: number = policy.otp.length): string {
  return randomDigits(length);
}

export function hashOtpCode(secret: string, otpId: string, code: string): string {
  return hmacSha256Hex(secret, `${otpId}:${code}`);
}

/** Trims spaces and converts Arabic-Indic digits so "١٢٣ ٤٥٦" works. */
export function normalizeOtpInput(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\s+/g, "");
}

export type OtpState = "active" | "expired" | "consumed" | "invalidated" | "locked";

export function otpState(
  row: { expiresAt: Date; consumedAt: Date | null; invalidatedAt: Date | null; attempts: number; maxAttempts: number },
  now: Date = new Date(),
): OtpState {
  if (row.consumedAt) return "consumed";
  if (row.invalidatedAt) return "invalidated";
  if (row.attempts >= row.maxAttempts) return "locked";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

export type IssueOtpResult =
  | { ok: true; otpId: string; code: string; expiresAt: Date }
  | { ok: false; reason: "rate_limited"; retryAt: Date };

export async function issueOtp(
  db: Db,
  input: { projectId: string; purpose: OtpPurpose; email: string; magicLinkId?: string | null; now?: Date; secret?: string },
): Promise<IssueOtpResult> {
  const now = input.now ?? new Date();
  const secret = input.secret ?? requireEnv("APP_SECRET");
  const limit = await hitRateLimit(
    db,
    `otp:issue:${input.projectId}:${input.purpose}`,
    policy.otp.maxIssuesPerHour,
    3600,
    now,
  );
  if (!limit.allowed) return { ok: false, reason: "rate_limited", retryAt: limit.resetAt };

  const otpId = randomUUID();
  const code = generateOtpCode();
  const expiresAt = new Date(now.getTime() + policy.otp.ttlMinutes * 60_000);

  await db.transaction(async (tx) => {
    await tx
      .update(otpCodes)
      .set({ invalidatedAt: now })
      .where(
        and(
          eq(otpCodes.projectId, input.projectId),
          eq(otpCodes.purpose, input.purpose),
          isNull(otpCodes.consumedAt),
          isNull(otpCodes.invalidatedAt),
        ),
      );
    await tx.insert(otpCodes).values({
      id: otpId,
      projectId: input.projectId,
      magicLinkId: input.magicLinkId ?? null,
      purpose: input.purpose,
      email: input.email,
      codeHash: hashOtpCode(secret, otpId, code),
      expiresAt,
      maxAttempts: policy.otp.maxAttempts,
      createdAt: now,
    });
  });

  return { ok: true, otpId, code, expiresAt };
}

export type VerifyOtpResult =
  | { ok: true; otpId: string }
  | { ok: false; reason: "no_active_code" | "expired" | "too_many_attempts"; attemptsLeft: 0 }
  | { ok: false; reason: "invalid_code"; attemptsLeft: number };

export async function verifyOtp(
  db: Db,
  input: { projectId: string; purpose: OtpPurpose; code: string; now?: Date; secret?: string },
): Promise<VerifyOtpResult> {
  const now = input.now ?? new Date();
  const secret = input.secret ?? requireEnv("APP_SECRET");

  const [row] = await db
    .select()
    .from(otpCodes)
    .where(
      and(
        eq(otpCodes.projectId, input.projectId),
        eq(otpCodes.purpose, input.purpose),
        isNull(otpCodes.consumedAt),
        isNull(otpCodes.invalidatedAt),
      ),
    )
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);

  if (!row) return { ok: false, reason: "no_active_code", attemptsLeft: 0 };
  const state = otpState(row, now);
  if (state === "expired") return { ok: false, reason: "expired", attemptsLeft: 0 };
  if (state === "locked") return { ok: false, reason: "too_many_attempts", attemptsLeft: 0 };

  // Count the attempt atomically before comparing, so parallel guesses cannot exceed the limit.
  const [counted] = await db
    .update(otpCodes)
    .set({ attempts: sql`${otpCodes.attempts} + 1` })
    .where(
      and(
        eq(otpCodes.id, row.id),
        lt(otpCodes.attempts, otpCodes.maxAttempts),
        isNull(otpCodes.consumedAt),
        isNull(otpCodes.invalidatedAt),
        gt(otpCodes.expiresAt, now),
      ),
    )
    .returning({ attempts: otpCodes.attempts, maxAttempts: otpCodes.maxAttempts });
  if (!counted) return { ok: false, reason: "too_many_attempts", attemptsLeft: 0 };

  const matches = safeEqualHex(hashOtpCode(secret, row.id, normalizeOtpInput(input.code)), row.codeHash);
  if (!matches) {
    return { ok: false, reason: "invalid_code", attemptsLeft: Math.max(0, counted.maxAttempts - counted.attempts) };
  }

  const [consumed] = await db
    .update(otpCodes)
    .set({ consumedAt: now })
    .where(and(eq(otpCodes.id, row.id), isNull(otpCodes.consumedAt)))
    .returning({ id: otpCodes.id });
  if (!consumed) return { ok: false, reason: "no_active_code", attemptsLeft: 0 };
  return { ok: true, otpId: row.id };
}

// ---------------------------------------------------------------------------
// Download grant: after a successful OTP, the portal keeps a short-lived signed
// grant (e.g. in an httpOnly cookie) instead of asking for a code per file.
// ---------------------------------------------------------------------------

export function createDownloadGrant(projectId: string, options: { now?: Date; secret?: string } = {}): string {
  const secret = options.secret ?? requireEnv("APP_SECRET");
  const expires = (options.now ?? new Date()).getTime() + policy.downloadGrantMinutes * 60_000;
  const payload = `${projectId}.${expires}`;
  return `${payload}.${hmacSha256Hex(secret, `download:${payload}`)}`;
}

export function verifyDownloadGrant(
  grant: string,
  projectId: string,
  options: { now?: Date; secret?: string } = {},
): boolean {
  const secret = options.secret ?? requireEnv("APP_SECRET");
  const parts = grant.split(".");
  if (parts.length !== 3) return false;
  const [grantProject, expiresRaw, signature] = parts as [string, string, string];
  if (grantProject !== projectId) return false;
  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires <= (options.now ?? new Date()).getTime()) return false;
  return safeEqualHex(hmacSha256Hex(secret, `download:${grantProject}.${expiresRaw}`), signature);
}
