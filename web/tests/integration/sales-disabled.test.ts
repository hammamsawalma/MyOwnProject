import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { documents, paymentMilestones } from "@/db/schema";
import { getSalesConfig, SalesDisabledError } from "@/lib/sales";
import { createMilestone, recordPayment, sendPaymentRequest } from "@/lib/services/payments";
import { getClientPortalView, requestClientOtp } from "@/lib/services/portal";
import { createClient, createProject, transitionProject } from "@/lib/services/projects";
import { acceptQuote, createQuoteDraft, sendQuote } from "@/lib/services/quotes";
import { latestOtpFromOutbox, openTestDb, resetDatabase } from "./helpers";

const handle = openTestDb();
const { db } = handle;

beforeEach(() => resetDatabase(handle));
afterAll(() => handle.close());

async function projectWithSentQuote() {
  const c = await createClient(db, { name: "Lena", email: "lena@example.com", country: "DE", language: "en" });
  const p = await createProject(db, { clientId: c.id, title: "Excel automation", currency: "EUR" });
  for (const to of ["qualified", "quote_draft"] as const) await transitionProject(db, { projectId: p.id, to, actor: "admin" });
  const { quote } = await createQuoteDraft(db, {
    projectId: p.id,
    currency: "EUR",
    title: "Excel automation",
    lineItems: [{ description: "Macro + dashboard", unitPriceMinor: 90_000 }],
  });
  const sent = await sendQuote(db, { quoteId: quote.id });
  return { projectId: p.id, quote: sent.quote };
}

describe("SALES_ENABLED=false (default)", () => {
  it("reads the flag from the environment and it is off", () => {
    expect(process.env.SALES_ENABLED).toBe("false");
    expect(getSalesConfig()).toEqual({ salesEnabled: false });
  });

  it("lets the admin send quotes and draft milestones, and the client view the quote", async () => {
    const { projectId, quote } = await projectWithSentQuote();
    expect(quote.ref).toMatch(/^Q-\d{4}-0001$/);
    const draft = await createMilestone(db, { projectId, kind: "deposit", amountMinor: 45_000, currency: "EUR" });
    expect(draft.status).toBe("draft");

    const view = await getClientPortalView(db, projectId);
    expect(view.view.stage).toBe("quote");
    expect(view.quotes).toHaveLength(1);
    expect(view.paymentPolicy).toMatchObject({ showPaymentLinks: false, canAcceptQuote: false });
    expect(view.paymentPolicy.notice?.ar).toBeTruthy();
    expect(view.paymentPolicy.notice?.en).toBeTruthy();
  });

  it("refuses to accept quotes, send payment requests or record payments", async () => {
    const { projectId, quote } = await projectWithSentQuote();
    await requestClientOtp(db, { projectId, purpose: "accept_quote" });
    const otpCode = await latestOtpFromOutbox(handle);
    await expect(
      acceptQuote(db, { projectId, quoteId: quote.id, otpCode, termsAccepted: true, startImmediatelyWaiver: true }),
    ).rejects.toBeInstanceOf(SalesDisabledError);

    const milestone = await createMilestone(db, { projectId, kind: "deposit", amountMinor: 45_000, currency: "EUR" });
    await expect(
      sendPaymentRequest(db, { milestoneId: milestone.id, payUrl: "https://pay.example/x", provider: "payoneer" }),
    ).rejects.toBeInstanceOf(SalesDisabledError);
    await expect(recordPayment(db, { milestoneId: milestone.id })).rejects.toBeInstanceOf(SalesDisabledError);

    const [row] = await db.select().from(paymentMilestones).where(eq(paymentMilestones.id, milestone.id));
    expect(row).toMatchObject({ status: "draft", payUrl: null, paidAt: null });
    expect(await db.select().from(documents).where(eq(documents.type, "receipt"))).toHaveLength(0);
  });

  it("never shows a stored payment link to the client while disabled", async () => {
    const { projectId } = await projectWithSentQuote();
    const milestone = await createMilestone(db, { projectId, kind: "deposit", amountMinor: 45_000, currency: "EUR" });
    // e.g. a link created while sales were on, then the flag was switched off
    await db
      .update(paymentMilestones)
      .set({ status: "sent", payUrl: "https://pay.example/leak" })
      .where(eq(paymentMilestones.id, milestone.id));
    const view = await getClientPortalView(db, projectId);
    expect(view.payments[0]?.payUrl).toBeNull();
    expect(JSON.stringify(view)).not.toContain("pay.example/leak");
  });
});
