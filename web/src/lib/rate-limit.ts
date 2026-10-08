import { eq, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { rateLimits } from "@/db/schema";

/** Fixed-window rate limiter stored in Postgres (works across processes). */

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  remaining: number;
  resetAt: Date;
}

export async function hitRateLimit(
  db: Db,
  key: string,
  limit: number,
  windowSeconds: number,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const cutoff = new Date(now.getTime() - windowSeconds * 1000).toISOString();
  const windowExpired = sql`${rateLimits.windowStartedAt} <= ${cutoff}::timestamptz`;
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStartedAt: now, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${windowExpired} then 1 else ${rateLimits.count} + 1 end`,
        windowStartedAt: sql`case when ${windowExpired} then ${now.toISOString()}::timestamptz else ${rateLimits.windowStartedAt} end`,
      },
    })
    .returning();
  if (!row) throw new Error("rate limit upsert returned no row");
  // Opportunistic cleanup (no scheduler yet): now and then, when a new window starts.
  if (row.count === 1 && Math.random() < PRUNE_PROBABILITY) await pruneRateLimits(db, now);
  return toResult(row.count, row.windowStartedAt, limit, windowSeconds);
}

const PRUNE_PROBABILITY = 0.02;
/** Longer than every window in use (the longest is one hour). */
const PRUNE_AFTER_SECONDS = 86_400;

/** Deletes rows whose window ended long ago. Returns how many were removed. */
export async function pruneRateLimits(db: Db, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - PRUNE_AFTER_SECONDS * 1000);
  const rows = await db
    .delete(rateLimits)
    .where(lt(rateLimits.windowStartedAt, cutoff))
    .returning({ key: rateLimits.key });
  return rows.length;
}

export async function resetRateLimit(db: Db, key: string): Promise<void> {
  await db.delete(rateLimits).where(eq(rateLimits.key, key));
}

function toResult(count: number, windowStartedAt: Date, limit: number, windowSeconds: number): RateLimitResult {
  return {
    allowed: count <= limit,
    count,
    remaining: Math.max(0, limit - count),
    resetAt: new Date(windowStartedAt.getTime() + windowSeconds * 1000),
  };
}
