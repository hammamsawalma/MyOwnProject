import { eq, sql } from "drizzle-orm";
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
  return toResult(row.count, row.windowStartedAt, limit, windowSeconds);
}

/** Current state without consuming a hit. */
export async function peekRateLimit(
  db: Db,
  key: string,
  limit: number,
  windowSeconds: number,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const [row] = await db.select().from(rateLimits).where(eq(rateLimits.key, key));
  if (!row || row.windowStartedAt.getTime() <= now.getTime() - windowSeconds * 1000) {
    return { allowed: true, count: 0, remaining: limit, resetAt: new Date(now.getTime() + windowSeconds * 1000) };
  }
  return { ...toResult(row.count, row.windowStartedAt, limit, windowSeconds), allowed: row.count < limit };
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
