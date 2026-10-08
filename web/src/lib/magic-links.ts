import { and, eq, isNull, sql } from "drizzle-orm";
import { env } from "@/config/env";
import { policy } from "@/config/policy";
import { CLIENT_PORTAL_PREFIX } from "@/config/routes";
import type { Db } from "@/db/client";
import { magicLinks } from "@/db/schema";
import { randomToken, sha256Hex } from "./crypto";
import { hitRateLimit } from "./rate-limit";

/**
 * Magic links give a client access to ONE project without an account
 * (report 07 §5.7): 256-bit random token in the URL, only its SHA-256 stored,
 * expiry (default 90 days), revocable, usage tracked, verification rate limited.
 */

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateMagicToken(): { token: string; tokenHash: string } {
  const token = randomToken(32);
  return { token, tokenHash: hashMagicToken(token) };
}

export function hashMagicToken(token: string): string {
  return sha256Hex(token);
}

export function isWellFormedMagicToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

export function magicLinkUrl(token: string, baseUrl: string = env().APP_BASE_URL): string {
  return `${baseUrl.replace(/\/+$/, "")}${CLIENT_PORTAL_PREFIX}/${token}`;
}

export type MagicLinkState = "active" | "expired" | "revoked";

export function magicLinkState(link: { expiresAt: Date; revokedAt: Date | null }, now: Date = new Date()): MagicLinkState {
  if (link.revokedAt) return "revoked";
  if (link.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

export interface CreatedMagicLink {
  id: string;
  projectId: string;
  token: string;
  url: string;
  expiresAt: Date;
}

export async function createMagicLink(
  db: Db,
  input: { projectId: string; ttlDays?: number; revokeExisting?: boolean; now?: Date },
): Promise<CreatedMagicLink> {
  const now = input.now ?? new Date();
  const ttlDays = input.ttlDays ?? env().MAGIC_LINK_TTL_DAYS;
  const expiresAt = new Date(now.getTime() + ttlDays * 86_400_000);
  const { token, tokenHash } = generateMagicToken();

  return db.transaction(async (tx) => {
    if (input.revokeExisting) {
      await tx
        .update(magicLinks)
        .set({ revokedAt: now })
        .where(and(eq(magicLinks.projectId, input.projectId), isNull(magicLinks.revokedAt)));
    }
    const [row] = await tx
      .insert(magicLinks)
      .values({ projectId: input.projectId, tokenHash, expiresAt, createdAt: now })
      .returning();
    if (!row) throw new Error("magic link insert failed");
    return { id: row.id, projectId: row.projectId, token, url: magicLinkUrl(token), expiresAt };
  });
}

export type VerifyMagicLinkResult =
  | { ok: true; linkId: string; projectId: string; expiresAt: Date }
  | { ok: false; reason: "malformed" | "not_found" | "expired" | "revoked" | "rate_limited" };

export async function verifyMagicLink(
  db: Db,
  token: string,
  context: { ip?: string | null; now?: Date } = {},
): Promise<VerifyMagicLinkResult> {
  const now = context.now ?? new Date();
  const limit = await hitRateLimit(
    db,
    `magic-link:ip:${context.ip ?? "unknown"}`,
    policy.magicLink.maxVerificationsPerWindow,
    policy.magicLink.windowSeconds,
    now,
  );
  if (!limit.allowed) return { ok: false, reason: "rate_limited" };
  if (!isWellFormedMagicToken(token)) return { ok: false, reason: "malformed" };

  const [link] = await db.select().from(magicLinks).where(eq(magicLinks.tokenHash, hashMagicToken(token)));
  if (!link) return { ok: false, reason: "not_found" };

  const state = magicLinkState(link, now);
  if (state !== "active") return { ok: false, reason: state };

  await db
    .update(magicLinks)
    .set({ lastUsedAt: now, lastUsedIp: context.ip ?? null, useCount: sql`${magicLinks.useCount} + 1` })
    .where(eq(magicLinks.id, link.id));

  return { ok: true, linkId: link.id, projectId: link.projectId, expiresAt: link.expiresAt };
}

export async function revokeMagicLink(db: Db, linkId: string, now: Date = new Date()): Promise<boolean> {
  const rows = await db
    .update(magicLinks)
    .set({ revokedAt: now })
    .where(and(eq(magicLinks.id, linkId), isNull(magicLinks.revokedAt)))
    .returning({ id: magicLinks.id });
  return rows.length > 0;
}

export async function revokeProjectMagicLinks(db: Db, projectId: string, now: Date = new Date()): Promise<number> {
  const rows = await db
    .update(magicLinks)
    .set({ revokedAt: now })
    .where(and(eq(magicLinks.projectId, projectId), isNull(magicLinks.revokedAt)))
    .returning({ id: magicLinks.id });
  return rows.length;
}

export async function listProjectMagicLinks(db: Db, projectId: string) {
  return db
    .select({
      id: magicLinks.id,
      expiresAt: magicLinks.expiresAt,
      revokedAt: magicLinks.revokedAt,
      lastUsedAt: magicLinks.lastUsedAt,
      lastUsedIp: magicLinks.lastUsedIp,
      useCount: magicLinks.useCount,
      createdAt: magicLinks.createdAt,
    })
    .from(magicLinks)
    .where(eq(magicLinks.projectId, projectId))
    .orderBy(magicLinks.createdAt);
}
