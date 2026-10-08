import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { costTotals, createCost, listCosts, upcomingRenewals } from "@/lib/services/costs";
import { getTodayOverview } from "@/lib/services/dashboard";
import { createClient, createProject } from "@/lib/services/projects";
import { getDocumentMode, getPaymentPolicy, setDocumentMode, setPaymentPolicyOverride } from "@/lib/settings";
import { openTestDb, resetDatabase } from "./helpers";

const handle = openTestDb();
const { db } = handle;

beforeEach(() => resetDatabase(handle));
afterAll(() => handle.close());

describe("costs", () => {
  it("records costs, totals them per category/currency and lists renewals", async () => {
    await createCost(db, {
      incurredOn: "2026-10-01",
      category: "server",
      vendor: "Hetzner",
      amountMinor: 1_190,
      currency: "EUR",
      recurring: "monthly",
      renewsOn: "2026-10-15",
    });
    await createCost(db, {
      incurredOn: "2026-10-02",
      category: "domain",
      vendor: "Cloudflare",
      amountMinor: 1_100,
      currency: "USD",
      recurring: "yearly",
      renewsOn: "2027-10-02",
    });
    await createCost(db, { incurredOn: "2026-10-05", category: "ads", vendor: "Meta", amountMinor: 30_000, currency: "USD" });
    await createCost(db, { incurredOn: "2026-10-06", category: "ads", vendor: "Google", amountMinor: 5_000, currency: "USD" });

    expect(await costTotals(db, { from: "2026-10-01", to: "2026-10-31" })).toEqual([
      { category: "ads", currency: "USD", totalMinor: 35_000 },
      { category: "domain", currency: "USD", totalMinor: 1_100 },
      { category: "server", currency: "EUR", totalMinor: 1_190 },
    ]);
    expect(await listCosts(db, { category: "ads" })).toHaveLength(2);
    const renewals = await upcomingRenewals(db, { today: "2026-10-08", days: 14 });
    expect(renewals.map((r) => r.vendor)).toEqual(["Hetzner"]);
  });

  it("validates input (USD/EUR only, known categories)", async () => {
    await expect(
      createCost(db, { incurredOn: "2026-10-01", category: "server", vendor: "X", amountMinor: 1, currency: "TRY" as "USD" }),
    ).rejects.toThrow();
    await expect(
      createCost(db, { incurredOn: "2026-10-01", category: "food" as "other", vendor: "X", amountMinor: 1, currency: "USD" }),
    ).rejects.toThrow();
  });
});

describe("settings and dashboard", () => {
  it("keeps document_mode and payment policy overrides", async () => {
    expect(await getDocumentMode(db)).toBe("receipt");
    await setDocumentMode(db, "tax_invoice_via_provider");
    expect(await getDocumentMode(db)).toBe("tax_invoice_via_provider");
    await setPaymentPolicyOverride(db, { largeSplit: [40, 30, 30] });
    expect((await getPaymentPolicy(db)).largeSplit).toEqual([40, 30, 30]);
    expect((await getPaymentPolicy(db)).twoPartSplit).toEqual([50, 50]);
  });

  it("builds the Today overview", async () => {
    const c = await createClient(db, { name: "Test" });
    await createProject(db, { clientId: c.id, title: "New lead" });
    const overview = await getTodayOverview(db);
    expect(overview.needsReply).toHaveLength(1);
    expect(overview.statusCounts).toEqual([{ status: "lead", n: 1 }]);
    expect(overview.collectedThisMonth).toEqual([]);
    expect(overview.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
