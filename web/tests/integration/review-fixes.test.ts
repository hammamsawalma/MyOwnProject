import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { changeRequests, magicLinks, otpCodes, quotes } from "@/db/schema";
import { createMagicLink } from "@/lib/magic-links";
import { assessChangeRequest, createChangeRequest } from "@/lib/services/change-requests";
import { getTodayOverview } from "@/lib/services/dashboard";
import { addDeliverable, getReleasedFinalDeliverable } from "@/lib/services/deliverables";
import {
  createMilestone,
  deleteDraftMilestone,
  listMilestones,
  markMilestone,
  recordPayment,
} from "@/lib/services/payments";
import { getClientPortalView, requestClientOtp, sendPortalLink } from "@/lib/services/portal";
import {
  createClient,
  createProject,
  getProject,
  transitionProject,
  updateProjectDetails,
} from "@/lib/services/projects";
import { acceptQuote, createQuoteDraft, sendQuote, type QuoteDraftInput } from "@/lib/services/quotes";
import type { ProjectStatus } from "@/lib/project-status";
import { latestOtpFromOutbox, openTestDb, resetDatabase, SALES_OFF, SALES_ON } from "./helpers";

/** Regression tests for the review findings (see docs/build/01-build-notes.md, "نتائج المراجعة"). */

const handle = openTestDb();
const { db } = handle;
const visitor = { ip: "203.0.113.20", userAgent: "Mozilla/5.0 (review test)" };

beforeEach(() => resetDatabase(handle));
afterAll(() => handle.close());

async function move(projectId: string, ...steps: ProjectStatus[]) {
  for (const to of steps) await transitionProject(db, { projectId, to, actor: "admin" });
}

const quoteInput = (projectId: string, unitPriceMinor = 100_000): QuoteDraftInput => ({
  projectId,
  currency: "USD",
  title: "Landing page",
  lineItems: [{ description: "Build", unitPriceMinor }],
});

async function acceptWithOtp(projectId: string, quoteId: string, now?: Date) {
  await requestClientOtp(db, { projectId, purpose: "accept_quote", now });
  const otpCode = await latestOtpFromOutbox(handle);
  return acceptQuote(db, {
    projectId,
    quoteId,
    otpCode,
    termsAccepted: true,
    startImmediatelyWaiver: true,
    ...visitor,
    now,
    sales: SALES_ON,
  });
}

/** A project with an accepted initial quote (default 1,000 USD, 50/50). */
async function acceptedProject(unitPriceMinor = 100_000) {
  const client = await createClient(db, { name: "Acme Ltd.", email: "ops@acme.example", language: "en" });
  const project = await createProject(db, { clientId: client.id, title: "Website" });
  await move(project.id, "quote_draft");
  const { quote: draft } = await createQuoteDraft(db, quoteInput(project.id, unitPriceMinor));
  const { quote } = await sendQuote(db, { quoteId: draft.id });
  const { milestones } = await acceptWithOtp(project.id, quote.id);
  return { client, project, quote, milestones };
}

const failingFetch = (async () =>
  new Response('{"message":"domain not verified"}', { status: 403 })) as unknown as typeof fetch;

describe("email delivery failures", () => {
  it("keeps the previous tracking link when the new one cannot be emailed", async () => {
    const client = await createClient(db, { name: "Sara", email: "sara@example.com" });
    const project = await createProject(db, { clientId: client.id, title: "Bot" });
    const old = await createMagicLink(db, { projectId: project.id });

    await expect(
      sendPortalLink(db, { projectId: project.id, email: { apiKey: "re_test", fetchImpl: failingFetch } }),
    ).rejects.toMatchObject({ code: "email_failed" });

    const active = await db
      .select()
      .from(magicLinks)
      .where(and(eq(magicLinks.projectId, project.id), isNull(magicLinks.revokedAt)));
    expect(active.map((l) => l.id)).toEqual([old.id]);
  });

  it("revokes older links only after the new link was emailed", async () => {
    const client = await createClient(db, { name: "Sara", email: "sara@example.com" });
    const project = await createProject(db, { clientId: client.id, title: "Bot" });
    await createMagicLink(db, { projectId: project.id });
    const link = await sendPortalLink(db, { projectId: project.id });
    const active = await db
      .select()
      .from(magicLinks)
      .where(and(eq(magicLinks.projectId, project.id), isNull(magicLinks.revokedAt)));
    expect(active.map((l) => l.id)).toEqual([link.id]);
  });

  it("does not report an OTP as sent when the email failed, and voids the code", async () => {
    const client = await createClient(db, { name: "Sara", email: "sara@example.com" });
    const project = await createProject(db, { clientId: client.id, title: "Bot" });
    await expect(
      requestClientOtp(db, {
        projectId: project.id,
        purpose: "download_final",
        email: { apiKey: "re_test", fetchImpl: failingFetch },
      }),
    ).rejects.toMatchObject({ code: "email_failed" });
    const open = await db
      .select()
      .from(otpCodes)
      .where(and(eq(otpCodes.projectId, project.id), isNull(otpCodes.invalidatedAt)));
    expect(open).toHaveLength(0);
  });
});

describe("add-on quotes", () => {
  it("keeps each change request's add-on quote open when another add-on is sent", async () => {
    const { project, milestones } = await acceptedProject();
    await recordPayment(db, { milestoneId: milestones[0]!.id, sales: SALES_ON });
    await move(project.id, "in_progress");

    const addonFor = async (description: string) => {
      const cr = await createChangeRequest(db, { projectId: project.id, description, requestedBy: "client" });
      await assessChangeRequest(db, cr.id, false);
      const { quote: draft } = await createQuoteDraft(db, {
        ...quoteInput(project.id, 20_000),
        kind: "addon",
        changeRequestId: cr.id,
      });
      const { quote } = await sendQuote(db, { quoteId: draft.id });
      return { cr, quote };
    };
    const a = await addonFor("Add a blog");
    const b = await addonFor("Add a contact form");

    const statuses = await db.select({ id: quotes.id, status: quotes.status }).from(quotes);
    expect(statuses.find((q) => q.id === a.quote.id)?.status).toBe("sent");
    expect(statuses.find((q) => q.id === b.quote.id)?.status).toBe("sent");

    await acceptWithOtp(project.id, a.quote.id);
    const [crA] = await db.select().from(changeRequests).where(eq(changeRequests.id, a.cr.id));
    expect(crA?.status).toBe("accepted");
  });

  it("requires add-on quotes and manual milestones to use the project currency", async () => {
    const { project } = await acceptedProject();
    await expect(
      createQuoteDraft(db, { ...quoteInput(project.id, 10_000), kind: "addon", currency: "EUR" }),
    ).rejects.toMatchObject({ code: "currency_mismatch" });
    await expect(
      createMilestone(db, { projectId: project.id, kind: "addon", amountMinor: 10_000, currency: "EUR" }),
    ).rejects.toMatchObject({ code: "currency_mismatch" });
  });
});

describe("payment schedule integrity", () => {
  it("refuses to delete draft milestones of an accepted quote", async () => {
    const { project, milestones } = await acceptedProject();
    await expect(deleteDraftMilestone(db, milestones[1]!.id)).rejects.toMatchObject({ code: "milestone_agreed" });
    const manual = await createMilestone(db, {
      projectId: project.id,
      kind: "addon",
      amountMinor: 5_000,
      currency: "USD",
    });
    await deleteDraftMilestone(db, manual.id);
    expect(await listMilestones(db, project.id)).toHaveLength(2);
  });

  it("derives milestone kinds from their position, so the first payment is always the deposit", async () => {
    const client = await createClient(db, { name: "Omar", email: "omar@example.com" });
    const project = await createProject(db, { clientId: client.id, title: "Shop" });
    await move(project.id, "quote_draft");
    const { quote: draft } = await createQuoteDraft(db, {
      ...quoteInput(project.id),
      paymentPlan: [{ kind: "balance", sequence: 1, percent: 100, amountMinor: 100_000 }],
    });
    expect(draft.paymentPlan.map((m) => m.kind)).toEqual(["deposit"]);
    const { quote } = await sendQuote(db, { quoteId: draft.id });
    const { milestones } = await acceptWithOtp(project.id, quote.id);
    await recordPayment(db, { milestoneId: milestones[0]!.id, sales: SALES_ON });
    expect((await getProject(db, project.id)).status).toBe("kickoff");
  });

  it("lets the admin resolve a dispute so the project can still be delivered", async () => {
    const { project, milestones } = await acceptedProject();
    const [deposit, balance] = milestones;
    await recordPayment(db, { milestoneId: deposit!.id, sales: SALES_ON });
    await markMilestone(db, { milestoneId: deposit!.id, status: "disputed", note: "chargeback" });
    const resolved = await markMilestone(db, { milestoneId: deposit!.id, status: "paid", note: "chargeback won" });
    expect(resolved.status).toBe("paid");

    await move(project.id, "in_progress", "internal_qa", "client_review", "awaiting_balance");
    await recordPayment(db, { milestoneId: balance!.id, sales: SALES_ON });
    expect((await getProject(db, project.id)).status).toBe("delivered");
  });

  it("computes receipt totals from the agreed schedule only", async () => {
    const { project, milestones } = await acceptedProject();
    await createMilestone(db, { projectId: project.id, kind: "addon", amountMinor: 20_000, currency: "USD" });
    const { receipt } = await recordPayment(db, { milestoneId: milestones[0]!.id, sales: SALES_ON });
    expect(receipt.snapshot).toMatchObject({
      contractTotalMinor: 100_000,
      paidToDateMinor: 50_000,
      remainingMinor: 50_000,
    });
  });

  it("locks released final files again after a refund", async () => {
    const { project, milestones } = await acceptedProject(10_000);
    await recordPayment(db, { milestoneId: milestones[0]!.id, sales: SALES_ON });
    const final = await addDeliverable(db, {
      projectId: project.id,
      kind: "final",
      title: "Source",
      externalUrl: "https://example.com/source",
    });
    await move(project.id, "in_progress", "internal_qa", "client_review", "delivered");
    expect((await getReleasedFinalDeliverable(db, project.id, final.id)).released).toBe(true);
    await markMilestone(db, { milestoneId: milestones[0]!.id, status: "refunded" });
    await expect(getReleasedFinalDeliverable(db, project.id, final.id)).rejects.toMatchObject({
      code: "milestones_unpaid",
    });
  });
});

describe("client acceptance availability", () => {
  it("does not offer acceptance on closed projects or expired quotes", async () => {
    const client = await createClient(db, { name: "Mona", email: "mona@example.com" });
    const project = await createProject(db, { clientId: client.id, title: "Bot" });
    await move(project.id, "quote_draft");
    const { quote: draft } = await createQuoteDraft(db, quoteInput(project.id));
    const sentAt = new Date(Date.now() - 10 * 86_400_000);
    const { quote } = await sendQuote(db, { quoteId: draft.id, now: sentAt });

    let view = await getClientPortalView(db, project.id, { sales: SALES_ON });
    expect(view.quotes[0]).toMatchObject({ status: "expired", canAccept: false });

    // The expiry is checked before the code is used up.
    await expect(acceptWithOtp(project.id, quote.id)).rejects.toMatchObject({ code: "quote_expired" });
    const [otp] = await db.select().from(otpCodes).where(eq(otpCodes.projectId, project.id));
    expect(otp?.consumedAt).toBeNull();

    const other = await createProject(db, { clientId: client.id, title: "Site" });
    await move(other.id, "quote_draft");
    const { quote: d2 } = await createQuoteDraft(db, quoteInput(other.id));
    await sendQuote(db, { quoteId: d2.id });
    view = await getClientPortalView(db, other.id, { sales: SALES_ON });
    expect(view.quotes[0]).toMatchObject({ status: "sent", canAccept: true });
    view = await getClientPortalView(db, other.id, { sales: SALES_OFF });
    expect(view.quotes[0]?.canAccept).toBe(false);
    await move(other.id, "lost");
    view = await getClientPortalView(db, other.id, { sales: SALES_ON });
    expect(view.quotes[0]?.canAccept).toBe(false);
  });
});

describe("dashboard", () => {
  it("does not flag a project as late on its due date", async () => {
    const client = await createClient(db, { name: "Ali", email: "ali@example.com" });
    const project = await createProject(db, { clientId: client.id, title: "Bot" });
    // Fast-forward to active work without the payment flow.
    await db.execute(sql`update projects set status = 'in_progress' where id = ${project.id}`);
    await updateProjectDetails(db, project.id, { title: "Bot", dueAt: new Date("2026-10-10T12:00:00Z") });
    // 15:30 in Istanbul on the due date itself.
    const onDueDate = await getTodayOverview(db, new Date("2026-10-10T12:30:00Z"));
    expect(onDueDate.lateProjects).toHaveLength(0);
    const dayAfter = await getTodayOverview(db, new Date("2026-10-11T06:00:00Z"));
    expect(dayAfter.lateProjects.map((p) => p.id)).toEqual([project.id]);
  });
});
