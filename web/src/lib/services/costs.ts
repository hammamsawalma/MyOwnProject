import { and, asc, eq, gte, isNotNull, lte, sql, sum } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { costs } from "@/db/schema";
import { COST_CATEGORIES, RECURRENCES, type CostCategory } from "@/lib/domain-enums";
import { NotFoundError } from "@/lib/errors";
import { CURRENCIES, type Currency } from "@/lib/money";

export type CostRow = typeof costs.$inferSelect;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const CostInput = z.object({
  incurredOn: isoDate,
  category: z.enum(COST_CATEGORIES),
  vendor: z.string().trim().min(1),
  description: z.string().nullish(),
  amountMinor: z.number().int().nonnegative(),
  currency: z.enum(CURRENCIES),
  projectId: z.uuid().nullish(),
  campaign: z.string().nullish(),
  recurring: z.enum(RECURRENCES).default("none"),
  renewsOn: isoDate.nullish(),
  notes: z.string().nullish(),
});

export async function createCost(db: Db, input: z.input<typeof CostInput>): Promise<CostRow> {
  const data = CostInput.parse(input);
  const [row] = await db
    .insert(costs)
    .values({
      ...data,
      description: data.description ?? null,
      projectId: data.projectId ?? null,
      campaign: data.campaign ?? null,
      renewsOn: data.renewsOn ?? null,
      notes: data.notes ?? null,
    })
    .returning();
  if (!row) throw new Error("cost insert failed");
  return row;
}

export async function updateCost(db: Db, id: string, input: z.input<typeof CostInput>): Promise<CostRow> {
  const data = CostInput.parse(input);
  const [row] = await db
    .update(costs)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(costs.id, id))
    .returning();
  if (!row) throw new NotFoundError("cost", id);
  return row;
}

export async function deleteCost(db: Db, id: string): Promise<void> {
  await db.delete(costs).where(eq(costs.id, id));
}

export async function listCosts(db: Db, filter: { from?: string; to?: string; category?: CostCategory } = {}) {
  const conditions = [
    filter.from ? gte(costs.incurredOn, filter.from) : undefined,
    filter.to ? lte(costs.incurredOn, filter.to) : undefined,
    filter.category ? eq(costs.category, filter.category) : undefined,
  ].filter((c) => c !== undefined);
  return db
    .select()
    .from(costs)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(costs.incurredOn));
}

export interface CostTotal {
  category: CostCategory;
  currency: Currency;
  totalMinor: number;
}

/** Totals per category and currency for a date range (inclusive). No FX conversion. */
export async function costTotals(db: Db, range: { from: string; to: string }): Promise<CostTotal[]> {
  const rows = await db
    .select({
      category: costs.category,
      currency: costs.currency,
      totalMinor: sum(costs.amountMinor).mapWith(Number),
    })
    .from(costs)
    .where(and(gte(costs.incurredOn, range.from), lte(costs.incurredOn, range.to)))
    .groupBy(costs.category, costs.currency)
    .orderBy(costs.category, costs.currency);
  return rows.map((r) => ({ ...r, totalMinor: r.totalMinor ?? 0 }));
}

/** Recurring costs renewing within `days` (report 07 §8.2: warn two weeks ahead). */
export async function upcomingRenewals(db: Db, options: { today: string; days?: number }) {
  const days = options.days ?? 14;
  return db
    .select()
    .from(costs)
    .where(
      and(
        isNotNull(costs.renewsOn),
        sql`${costs.recurring} <> 'none'`,
        gte(costs.renewsOn, options.today),
        lte(costs.renewsOn, sql`(${options.today}::date + ${days}::int)::date`),
      ),
    )
    .orderBy(asc(costs.renewsOn));
}
