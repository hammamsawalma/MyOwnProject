import { describe, expect, it } from "vitest";
import {
  assertPlanMatchesTotal,
  canReleaseFinalDeliverables,
  DEFAULT_PAYMENT_POLICY,
  defaultPaymentPlan,
  nextUnpaidMilestone,
  PaymentPlanError,
  resolvePaymentPolicy,
} from "@/lib/payment-plan";

const summary = (total: number, type: "project" | "addon" = "project") =>
  defaultPaymentPlan(total, "USD", DEFAULT_PAYMENT_POLICY, type).map((m) => `${m.kind}:${m.percent}:${m.amountMinor}`);

describe("default payment plan (report 09 §4.1)", () => {
  it("is 100% upfront below 150", () => {
    expect(summary(14_999)).toEqual(["deposit:100:14999"]);
    expect(summary(5_000)).toEqual(["deposit:100:5000"]);
  });

  it("is 50/50 from 150 up to and including 2,000", () => {
    expect(summary(15_000)).toEqual(["deposit:50:7500", "balance:50:7500"]);
    expect(summary(200_000)).toEqual(["deposit:50:100000", "balance:50:100000"]);
  });

  it("is 30/40/30 above 2,000", () => {
    expect(summary(200_001)).toEqual(["deposit:30:60000", "interim:40:80000", "balance:30:60001"]);
    expect(summary(1_000_000)).toEqual(["deposit:30:300000", "interim:40:400000", "balance:30:300000"]);
  });

  it("uses the add-on policy for change requests", () => {
    expect(summary(10_000, "addon")).toEqual(["addon:100:10000"]);
    expect(summary(50_000, "addon")).toEqual(["addon:50:25000", "addon:50:25000"]);
  });

  it("numbers milestones and covers the total", () => {
    const plan = defaultPaymentPlan(333_333, "EUR");
    expect(plan.map((m) => m.sequence)).toEqual([1, 2, 3]);
    expect(() => assertPlanMatchesTotal(plan, 333_333)).not.toThrow();
    expect(defaultPaymentPlan(0, "USD")).toEqual([]);
  });
});

describe("configurable policy", () => {
  it("merges overrides onto the defaults", () => {
    const policy = resolvePaymentPolicy({ twoPartSplit: [40, 60], fullUpfrontBelowMinor: 10_000 });
    expect(policy.twoPartSplit).toEqual([40, 60]);
    expect(policy.largeSplit).toEqual([30, 40, 30]);
    expect(defaultPaymentPlan(12_000, "USD", policy).map((m) => m.percent)).toEqual([40, 60]);
    expect(resolvePaymentPolicy(null)).toEqual(DEFAULT_PAYMENT_POLICY);
  });

  it("rejects invalid overrides", () => {
    expect(() => resolvePaymentPolicy({ largeSplit: [30, 30] })).toThrow();
    expect(() => resolvePaymentPolicy({ twoPartMaxMinor: -1 })).toThrow();
  });
});

describe("plan validation and release rule", () => {
  it("rejects plans that do not cover the total", () => {
    expect(() =>
      assertPlanMatchesTotal([{ kind: "deposit", sequence: 1, percent: 100, amountMinor: 900 }], 1_000),
    ).toThrow(PaymentPlanError);
    expect(() => assertPlanMatchesTotal([], 1_000)).toThrow(PaymentPlanError);
  });

  it("releases final deliverables only when every milestone is paid", () => {
    expect(canReleaseFinalDeliverables([])).toBe(false);
    expect(canReleaseFinalDeliverables([{ status: "paid" }, { status: "sent" }])).toBe(false);
    expect(canReleaseFinalDeliverables([{ status: "paid" }, { status: "refunded" }])).toBe(false);
    expect(canReleaseFinalDeliverables([{ status: "paid" }, { status: "paid" }])).toBe(true);
  });

  it("finds the next unpaid milestone by sequence", () => {
    const next = nextUnpaidMilestone([
      { sequence: 2, status: "draft" as const },
      { sequence: 1, status: "paid" as const },
      { sequence: 3, status: "draft" as const },
    ]);
    expect(next?.sequence).toBe(2);
  });
});
