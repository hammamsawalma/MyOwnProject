import { sql } from "drizzle-orm";
import { env } from "@/config/env";
import type { Db } from "@/db/client";
import { documentCounters } from "@/db/schema";

/**
 * Gapless numbering: Q-2026-0001 (quotes), R-2026-0001 (receipts), CN-2026-0001
 * (credit notes), P-2026-0001 (projects). One counter row per series and year.
 *
 * allocateNumber() MUST run inside the transaction that inserts the numbered row.
 * The upsert locks the counter row until commit, so concurrent issuers queue up,
 * and a rollback also rolls back the increment, which leaves no gaps. Plain
 * Postgres sequences are not used because they skip values on rollback.
 */

export const NUMBER_SERIES = {
  quote: "Q",
  receipt: "R",
  creditNote: "CN",
  project: "P",
} as const;

export type NumberSeries = (typeof NUMBER_SERIES)[keyof typeof NUMBER_SERIES];

const SERIES_VALUES = Object.values(NUMBER_SERIES) as readonly string[];

export function formatDocumentNumber(series: NumberSeries, year: number, n: number): string {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid sequence number: ${n}`);
  return `${series}-${year}-${String(n).padStart(4, "0")}`;
}

export function parseDocumentNumber(ref: string): { series: NumberSeries; year: number; number: number } | null {
  const match = /^([A-Z]{1,3})-(\d{4})-(\d{4,})$/.exec(ref);
  if (!match || !SERIES_VALUES.includes(match[1] ?? "")) return null;
  return { series: match[1] as NumberSeries, year: Number(match[2]), number: Number(match[3]) };
}

/** Calendar year of `date` in the business time zone (documents follow local time). */
export function yearInTimeZone(date: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(date));
}

export interface AllocatedNumber {
  ref: string;
  series: NumberSeries;
  year: number;
  number: number;
}

export async function allocateNumber(
  tx: Db,
  series: NumberSeries,
  options: { date?: Date; timeZone?: string } = {},
): Promise<AllocatedNumber> {
  const year = yearInTimeZone(options.date ?? new Date(), options.timeZone ?? env().BUSINESS_TIMEZONE);
  const [row] = await tx
    .insert(documentCounters)
    .values({ series, year, lastNumber: 1 })
    .onConflictDoUpdate({
      target: [documentCounters.series, documentCounters.year],
      set: { lastNumber: sql`${documentCounters.lastNumber} + 1`, updatedAt: new Date() },
    })
    .returning({ lastNumber: documentCounters.lastNumber });
  if (!row) throw new Error(`Counter allocation failed for ${series}-${year}`);
  return { ref: formatDocumentNumber(series, year, row.lastNumber), series, year, number: row.lastNumber };
}
