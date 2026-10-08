import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { documentCounters, settings } from "@/db/schema";
import { allocateNumber, NUMBER_SERIES } from "@/lib/numbering";
import { openTestDb, resetDatabase } from "./helpers";

const handle = openTestDb(25);
const { db } = handle;
const date = new Date("2026-10-08T12:00:00Z");

beforeEach(() => resetDatabase(handle));
afterAll(() => handle.close());

/** Allocates a number and writes a row keyed by it in the same transaction. */
async function issue(fail = false): Promise<string> {
  return db.transaction(async (tx) => {
    const { ref } = await allocateNumber(tx, NUMBER_SERIES.receipt, { date });
    await tx.insert(settings).values({ key: `doc:${ref}`, value: true });
    // Hold the lock a little so transactions genuinely overlap.
    await new Promise((r) => setTimeout(r, 5));
    if (fail) throw new Error("simulated failure after allocation");
    return ref;
  });
}

async function committedRefs(): Promise<string[]> {
  const rows = await db.select({ key: settings.key }).from(settings).where(like(settings.key, "doc:%"));
  return rows.map((r) => r.key.slice(4)).sort();
}

const expectedRefs = (n: number) =>
  Array.from({ length: n }, (_, i) => `R-2026-${String(i + 1).padStart(4, "0")}`);

describe("gapless numbering", () => {
  it("hands out unique consecutive numbers to 40 parallel transactions", async () => {
    const refs = await Promise.all(Array.from({ length: 40 }, () => issue()));
    expect(new Set(refs).size).toBe(40);
    expect([...refs].sort()).toEqual(expectedRefs(40));
    expect(await committedRefs()).toEqual(expectedRefs(40));
  });

  it("leaves no gap when a transaction rolls back after allocating", async () => {
    expect(await issue()).toBe("R-2026-0001");
    await expect(issue(true)).rejects.toThrow("simulated failure");
    expect(await issue()).toBe("R-2026-0002");
  });

  it("stays gapless with mixed commits and rollbacks in parallel", async () => {
    const results = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => issue(i % 3 === 0)));
    const committed = results.filter((r) => r.status === "fulfilled").length;
    expect(committed).toBe(20);
    expect(await committedRefs()).toEqual(expectedRefs(20));
    const [counter] = await db.select().from(documentCounters).where(eq(documentCounters.series, "R"));
    expect(counter?.lastNumber).toBe(20);
  });

  it("keeps separate sequences per series and per year", async () => {
    await db.transaction(async (tx) => {
      expect((await allocateNumber(tx, NUMBER_SERIES.quote, { date })).ref).toBe("Q-2026-0001");
      expect((await allocateNumber(tx, NUMBER_SERIES.receipt, { date })).ref).toBe("R-2026-0001");
      expect((await allocateNumber(tx, NUMBER_SERIES.creditNote, { date })).ref).toBe("CN-2026-0001");
      expect((await allocateNumber(tx, NUMBER_SERIES.quote, { date })).ref).toBe("Q-2026-0002");
      const nextYear = new Date("2027-01-01T00:30:00Z");
      expect((await allocateNumber(tx, NUMBER_SERIES.quote, { date: nextYear })).ref).toBe("Q-2027-0001");
    });
  });
});
