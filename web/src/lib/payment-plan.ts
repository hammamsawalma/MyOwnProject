import { z } from "zod";
import { splitByPercentages, type Currency } from "./money";
import type { Localized } from "./types";

/**
 * Default payment structure from research report 09 §4.1 (proposal for decision
 * Q10, configurable): 100% upfront below 150, 50/50 up to 2,000, 30/40/30 above.
 * Change requests (add-ons): 100% below 150, otherwise 50/50.
 * Thresholds apply in the quote's own currency (USD or EUR).
 */

export const MILESTONE_KINDS = ["deposit", "interim", "balance", "addon"] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

export const MILESTONE_STATUSES = ["draft", "sent", "paid", "refunded", "disputed"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const MILESTONE_KIND_LABELS: Record<MilestoneKind, Localized> = {
  deposit: { ar: "الدفعة المقدمة", en: "Deposit" },
  interim: { ar: "دفعة مرحلية", en: "Interim payment" },
  balance: { ar: "الدفعة الأخيرة", en: "Final payment" },
  addon: { ar: "دفعة إضافة", en: "Add-on payment" },
};

const percentList = z
  .array(z.number().int().positive())
  .min(1)
  .refine((list) => list.reduce((a, b) => a + b, 0) === 100, { message: "must sum to 100" });

export const PaymentPolicySchema = z.object({
  /** Totals strictly below this (minor units) are paid 100% upfront. */
  fullUpfrontBelowMinor: z.number().int().nonnegative(),
  /** Totals up to and including this use the two-part split. */
  twoPartMaxMinor: z.number().int().positive(),
  twoPartSplit: percentList,
  largeSplit: percentList,
  addonFullUpfrontBelowMinor: z.number().int().nonnegative(),
  addonSplit: percentList,
});

export type PaymentPolicy = z.infer<typeof PaymentPolicySchema>;

export const DEFAULT_PAYMENT_POLICY: PaymentPolicy = {
  fullUpfrontBelowMinor: 15_000,
  twoPartMaxMinor: 200_000,
  twoPartSplit: [50, 50],
  largeSplit: [30, 40, 30],
  addonFullUpfrontBelowMinor: 15_000,
  addonSplit: [50, 50],
};

/** Merges a partial override (e.g. from the settings table) onto the defaults. */
export function resolvePaymentPolicy(override: unknown): PaymentPolicy {
  if (override === null || override === undefined) return DEFAULT_PAYMENT_POLICY;
  const partial = PaymentPolicySchema.partial().parse(override);
  return PaymentPolicySchema.parse({ ...DEFAULT_PAYMENT_POLICY, ...partial });
}

export interface PlannedMilestone {
  kind: MilestoneKind;
  sequence: number;
  percent: number;
  amountMinor: number;
}

export type PlanType = "project" | "addon";

export function splitFor(totalMinor: number, policy: PaymentPolicy, type: PlanType): number[] {
  if (type === "addon") {
    return totalMinor < policy.addonFullUpfrontBelowMinor ? [100] : policy.addonSplit;
  }
  if (totalMinor < policy.fullUpfrontBelowMinor) return [100];
  if (totalMinor <= policy.twoPartMaxMinor) return policy.twoPartSplit;
  return policy.largeSplit;
}

function kindFor(index: number, count: number, type: PlanType): MilestoneKind {
  if (type === "addon") return "addon";
  if (index === 0) return "deposit";
  if (index === count - 1) return "balance";
  return "interim";
}

export function defaultPaymentPlan(
  totalMinor: number,
  _currency: Currency,
  policy: PaymentPolicy = DEFAULT_PAYMENT_POLICY,
  type: PlanType = "project",
): PlannedMilestone[] {
  if (totalMinor <= 0) return [];
  const percents = splitFor(totalMinor, policy, type);
  const amounts = splitByPercentages(totalMinor, percents);
  return percents.map((percent, i) => ({
    kind: kindFor(i, percents.length, type),
    sequence: i + 1,
    percent,
    amountMinor: amounts[i] ?? 0,
  }));
}

export class PaymentPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentPlanError";
  }
}

/** A plan edited by the admin must still cover the quote total exactly. */
export function assertPlanMatchesTotal(plan: readonly PlannedMilestone[], totalMinor: number): void {
  if (totalMinor > 0 && plan.length === 0) throw new PaymentPlanError("Payment plan is empty");
  if (plan.some((m) => !Number.isSafeInteger(m.amountMinor) || m.amountMinor <= 0)) {
    throw new PaymentPlanError("Every milestone amount must be a positive integer");
  }
  const sum = plan.reduce((acc, m) => acc + m.amountMinor, 0);
  if (sum !== totalMinor) throw new PaymentPlanError(`Milestones sum to ${sum}, expected ${totalMinor}`);
}

interface MilestoneLike {
  status: MilestoneStatus;
}

/** Final deliverables are released only after every milestone is paid (report 09 §4.1). */
export function canReleaseFinalDeliverables(milestones: readonly MilestoneLike[]): boolean {
  return milestones.length > 0 && milestones.every((m) => m.status === "paid");
}

export function nextUnpaidMilestone<T extends MilestoneLike & { sequence: number }>(
  milestones: readonly T[],
): T | undefined {
  return [...milestones].sort((a, b) => a.sequence - b.sequence).find((m) => m.status !== "paid");
}
