import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { policy } from "@/config/policy";
import { magicLinks, rateLimits } from "@/db/schema";
import { sha256Hex } from "@/lib/crypto";
import {
  createMagicLink,
  generateMagicToken,
  listProjectMagicLinks,
  revokeMagicLink,
  revokeProjectMagicLinks,
  verifyMagicLink,
} from "@/lib/magic-links";
import { hitRateLimit, pruneRateLimits } from "@/lib/rate-limit";
import { createClient, createProject } from "@/lib/services/projects";
import { openTestDb, resetDatabase } from "./helpers";

const handle = openTestDb();
const { db } = handle;
let projectId: string;

beforeEach(async () => {
  await resetDatabase(handle);
  const client = await createClient(db, { name: "عميل تجريبي", email: "client@example.com" });
  projectId = (await createProject(db, { clientId: client.id, title: "مشروع" })).id;
});
afterAll(() => handle.close());

describe("magic links", () => {
  it("stores only the SHA-256 of the token and verifies it", async () => {
    const link = await createMagicLink(db, { projectId });
    expect(link.url).toBe(`http://localhost:3000/p/${link.token}`);
    const [row] = await db.select().from(magicLinks).where(eq(magicLinks.id, link.id));
    expect(row?.tokenHash).toBe(sha256Hex(link.token));
    expect(JSON.stringify(row)).not.toContain(link.token);

    const result = await verifyMagicLink(db, link.token, { ip: "203.0.113.5" });
    expect(result).toMatchObject({ ok: true, projectId });
  });

  it("defaults to a 90-day expiry and tracks usage", async () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const link = await createMagicLink(db, { projectId, now });
    expect(link.expiresAt.toISOString()).toBe("2027-01-06T12:00:00.000Z");
    await verifyMagicLink(db, link.token, { ip: "203.0.113.5", now });
    await verifyMagicLink(db, link.token, { ip: "203.0.113.6", now });
    const [info] = await listProjectMagicLinks(db, projectId);
    expect(info?.useCount).toBe(2);
    expect(info?.lastUsedIp).toBe("203.0.113.6");
    expect(info?.lastUsedAt?.toISOString()).toBe(now.toISOString());
  });

  it("rejects expired, revoked, unknown and malformed tokens", async () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const short = await createMagicLink(db, { projectId, ttlDays: 1, now });
    const later = new Date(now.getTime() + 2 * 86_400_000);
    expect(await verifyMagicLink(db, short.token, { now: later })).toEqual({ ok: false, reason: "expired" });

    const revoked = await createMagicLink(db, { projectId });
    expect(await revokeMagicLink(db, revoked.id)).toBe(true);
    expect(await revokeMagicLink(db, revoked.id)).toBe(false);
    expect(await verifyMagicLink(db, revoked.token)).toEqual({ ok: false, reason: "revoked" });

    expect(await verifyMagicLink(db, generateMagicToken().token)).toEqual({ ok: false, reason: "not_found" });
    expect(await verifyMagicLink(db, "not-a-token")).toEqual({ ok: false, reason: "malformed" });
  });

  it("can rotate: a new link revokes the old ones", async () => {
    const first = await createMagicLink(db, { projectId });
    const second = await createMagicLink(db, { projectId, revokeExisting: true });
    expect((await verifyMagicLink(db, first.token)).ok).toBe(false);
    expect((await verifyMagicLink(db, second.token)).ok).toBe(true);
    expect(await revokeProjectMagicLinks(db, projectId)).toBe(1);
    expect((await verifyMagicLink(db, second.token)).ok).toBe(false);
  });

  it("rate limits verification attempts per IP", async () => {
    const link = await createMagicLink(db, { projectId });
    const ip = "198.51.100.7";
    const max = policy.magicLink.maxVerificationsPerWindow;
    // Malformed tokens are rejected before the limiter and leave no row behind.
    expect(await verifyMagicLink(db, "guess", { ip: "198.51.100.99" })).toEqual({ ok: false, reason: "malformed" });
    expect(await db.select().from(rateLimits)).toHaveLength(0);
    for (let i = 0; i < max; i++) await verifyMagicLink(db, generateMagicToken().token, { ip });
    expect(await verifyMagicLink(db, link.token, { ip })).toEqual({ ok: false, reason: "rate_limited" });
    expect((await verifyMagicLink(db, link.token, { ip: "198.51.100.8" })).ok).toBe(true);
    const nextWindow = new Date(Date.now() + (policy.magicLink.windowSeconds + 1) * 1000);
    expect((await verifyMagicLink(db, link.token, { ip, now: nextWindow })).ok).toBe(true);
  });

  it("skips the per-IP limit when the IP is unknown (no trusted proxy)", async () => {
    const link = await createMagicLink(db, { projectId });
    expect((await verifyMagicLink(db, link.token)).ok).toBe(true);
    expect(await db.select().from(rateLimits)).toHaveLength(0);
  });

  it("prunes rate-limit rows whose window ended long ago", async () => {
    const now = new Date();
    await hitRateLimit(db, "old", 5, 60, new Date(now.getTime() - 2 * 86_400_000));
    await hitRateLimit(db, "fresh", 5, 60, now);
    expect(await pruneRateLimits(db, now)).toBe(1);
    expect((await db.select().from(rateLimits)).map((r) => r.key)).toEqual(["fresh"]);
  });
});
