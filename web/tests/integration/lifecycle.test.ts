import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "@/config/env";
import { policy } from "@/config/policy";
import { consents, documents, projectEvents, projects, quotes } from "@/db/schema";
import { verifyMagicLink, createMagicLink } from "@/lib/magic-links";
import { yearInTimeZone } from "@/lib/numbering";
import { closePdfBrowser } from "@/lib/pdf/render";
import type { ClientStage, ProjectStatus } from "@/lib/project-status";
import { assessChangeRequest, createChangeRequest, resolveChangeRequest } from "@/lib/services/change-requests";
import { addDeliverable, getReleasedFinalDeliverable, releaseFinalDeliverables } from "@/lib/services/deliverables";
import { generateDocumentPdf, issueCreditNote, listProjectDocuments } from "@/lib/services/documents";
import { listMilestones, recordPayment, sendPaymentRequest } from "@/lib/services/payments";
import { getClientPortalView, requestClientOtp } from "@/lib/services/portal";
import { createClient, createProject, getProject, listProjectEvents, transitionProject } from "@/lib/services/projects";
import { acceptQuote, createQuoteDraft, sendQuote, updateQuoteDraft, type QuoteDraftInput } from "@/lib/services/quotes";
import { latestOtpFromOutbox, openTestDb, resetDatabase, SALES_ON } from "./helpers";

const handle = openTestDb();
const { db } = handle;
const YEAR = yearInTimeZone(new Date(), "Europe/Istanbul");
const ref = (series: string, n: number) => `${series}-${YEAR}-${String(n).padStart(4, "0")}`;
const client = { ip: "203.0.113.10", userAgent: "Mozilla/5.0 (integration test)" };

beforeEach(() => resetDatabase(handle));
afterAll(async () => {
  await closePdfBrowser();
  await handle.close();
});

async function move(projectId: string, ...steps: ProjectStatus[]) {
  for (const to of steps) await transitionProject(db, { projectId, to, actor: "admin" });
}

async function expectClient(projectId: string, stage: ClientStage, flags: string[] = []) {
  const view = await getClientPortalView(db, projectId, { sales: SALES_ON });
  expect(view.view.stage).toBe(stage);
  expect(view.view.flags).toEqual(flags);
  return view;
}

async function acceptWithOtp(projectId: string, quoteId: string) {
  await requestClientOtp(db, { projectId, purpose: "accept_quote" });
  const otpCode = await latestOtpFromOutbox(handle);
  return acceptQuote(db, {
    projectId,
    quoteId,
    otpCode,
    termsAccepted: true,
    startImmediatelyWaiver: true,
    ...client,
    sales: SALES_ON,
  });
}

const draftInput = (projectId: string): QuoteDraftInput => ({
  projectId,
  currency: "USD",
  title: "موظف استقبال واتساب ذكي",
  summary: "رد آلي على استفسارات العملاء وحجز المواعيد.",
  scopeIncluded: ["إعداد البوت على رقم واتساب العميل", "تدريب البوت على 30 سؤالًا"],
  scopeExcluded: ["رسوم ميتا لرسائل واتساب"],
  acceptanceCriteria: ["يرد البوت على الأسئلة الثلاثين بشكل صحيح"],
  timeline: "10 أيام عمل",
  revisionsIncluded: 2,
  warrantyDays: 30,
  lineItems: [
    { description: "إعداد البوت وربطه", unitPriceMinor: 60_000 },
    { description: "جلسة تدريب", quantity: 2, unitPriceMinor: 10_000 },
  ],
});

describe("project lifecycle: lead -> closed", () => {
  it("walks a custom project through every stage with documents, payments and the release rule", async () => {
    // --- Lead and qualification -------------------------------------------------
    const c = await createClient(db, {
      name: "سارة",
      type: "company",
      companyName: "شركة النور",
      email: "sara@alnoor.example",
      country: "SA",
      language: "ar",
    });
    const project = await createProject(db, { clientId: c.id, title: "بوت واتساب لشركة النور" });
    expect(project.ref).toBe(ref("P", 1));
    expect(project.status).toBe("lead");
    await expectClient(project.id, "received");

    await move(project.id, "qualified", "discovery", "quote_draft");
    await expect(transitionProject(db, { projectId: project.id, to: "quote_sent", actor: "admin" })).rejects.toMatchObject({
      code: "quote_not_sent",
    });

    // --- Quote: draft, edit, send ------------------------------------------------
    const { quote: draft } = await createQuoteDraft(db, draftInput(project.id));
    expect(draft.totalMinor).toBe(80_000);
    expect(draft.paymentPlan.map((m) => [m.kind, m.amountMinor])).toEqual([
      ["deposit", 40_000],
      ["balance", 40_000],
    ]);
    const { quote: edited } = await updateQuoteDraft(db, draft.id, { ...draftInput(project.id), discountMinor: 0 });
    expect(edited.ref).toBeNull();

    const { quote, document: quoteDoc } = await sendQuote(db, { quoteId: draft.id });
    expect(quote.ref).toBe(ref("Q", 1));
    expect(quote.termsVersion).toBe(policy.termsVersion);
    expect(quoteDoc).toMatchObject({ ref: ref("Q", 1), type: "quote_pdf", amountMinor: 80_000, documentMode: "receipt" });
    expect((await getProject(db, project.id)).status).toBe("quote_sent");
    await expectClient(project.id, "quote");

    // Issued quotes and documents are immutable at the database level.
    await expect(db.update(quotes).set({ totalMinor: 1, subtotalMinor: 1 }).where(eq(quotes.id, quote.id))).rejects.toThrow();
    await expect(db.update(documents).set({ amountMinor: 1 }).where(eq(documents.id, quoteDoc.id))).rejects.toThrow();
    await expect(db.delete(documents).where(eq(documents.id, quoteDoc.id))).rejects.toThrow();
    await expect(updateQuoteDraft(db, quote.id, draftInput(project.id))).rejects.toMatchObject({ code: "quote_not_draft" });

    // --- Client opens the magic link and accepts with OTP + consents -------------
    const link = await createMagicLink(db, { projectId: project.id });
    const access = await verifyMagicLink(db, link.token, { ip: client.ip });
    expect(access).toMatchObject({ ok: true, projectId: project.id });

    await requestClientOtp(db, { projectId: project.id, purpose: "accept_quote" });
    const code = await latestOtpFromOutbox(handle);
    const base = { projectId: project.id, quoteId: quote.id, termsAccepted: true, ...client, sales: SALES_ON };
    await expect(acceptQuote(db, { ...base, otpCode: code, startImmediatelyWaiver: false })).rejects.toMatchObject({
      code: "waiver_required",
    });
    const wrong = code === "000000" ? "111111" : "000000";
    await expect(acceptQuote(db, { ...base, otpCode: wrong, startImmediatelyWaiver: true })).rejects.toMatchObject({
      code: "otp_invalid_code",
    });
    const accepted = await acceptQuote(db, { ...base, otpCode: code, startImmediatelyWaiver: true });
    expect(accepted.quote).toMatchObject({ status: "accepted", acceptedIp: client.ip, acceptedTermsVersion: policy.termsVersion });
    expect(accepted.milestones.map((m) => [m.kind, m.status, m.amountMinor])).toEqual([
      ["deposit", "draft", 40_000],
      ["balance", "draft", 40_000],
    ]);
    const recorded = await db.select().from(consents).where(eq(consents.quoteId, quote.id));
    expect(recorded.map((r) => r.kind).sort()).toEqual(["eu_withdrawal_waiver", "terms"]);
    expect(recorded.every((r) => r.ip === client.ip && r.userAgent === client.userAgent && r.granted)).toBe(true);
    expect(recorded.every((r) => r.version === policy.termsVersion)).toBe(true);
    await expectClient(project.id, "awaiting_deposit");

    // --- Deposit -----------------------------------------------------------------
    await expect(transitionProject(db, { projectId: project.id, to: "kickoff", actor: "admin" })).rejects.toMatchObject({
      code: "deposit_not_paid",
    });
    const [deposit, balance] = accepted.milestones;
    if (!deposit || !balance) throw new Error("milestones missing");
    await sendPaymentRequest(db, {
      milestoneId: deposit.id,
      payUrl: "https://payoneer.example/request/1",
      provider: "payoneer",
      sales: SALES_ON,
    });
    const portalWithLink = await getClientPortalView(db, project.id, { sales: SALES_ON });
    expect(portalWithLink.payments[0]?.payUrl).toBe("https://payoneer.example/request/1");

    const depositPaid = await recordPayment(db, { milestoneId: deposit.id, providerRef: "PO-1", sales: SALES_ON });
    expect(depositPaid.receipt).toMatchObject({ ref: ref("R", 1), type: "receipt", amountMinor: 40_000 });
    expect(depositPaid.receipt.snapshot).toMatchObject({ remainingMinor: 40_000, paidToDateMinor: 40_000 });
    expect((await getProject(db, project.id)).status).toBe("kickoff");
    await expectClient(project.id, "in_progress");

    // --- Work, QA, preview ---------------------------------------------------------
    await move(project.id, "in_progress", "internal_qa", "client_review");
    await addDeliverable(db, {
      projectId: project.id,
      kind: "preview",
      title: "فيديو المعاينة",
      externalUrl: "https://example.com/preview",
    });
    const finalFile = await addDeliverable(db, {
      projectId: project.id,
      kind: "final",
      title: "ملف الإعدادات النهائي",
      file: { data: Buffer.from("final-config"), fileName: "config.json", mimeType: "application/json" },
    });
    expect(finalFile.released).toBe(false);
    await expect(releaseFinalDeliverables(db, project.id)).rejects.toMatchObject({ code: "milestones_unpaid" });
    await expect(getReleasedFinalDeliverable(db, project.id, finalFile.id)).rejects.toMatchObject({ code: "not_released" });
    const review = await expectClient(project.id, "client_review");
    expect(review.deliverables.find((d) => d.kind === "final")?.externalUrl).toBeNull();

    // --- Revisions round -----------------------------------------------------------
    await move(project.id, "revisions");
    await expectClient(project.id, "in_progress", ["revisions"]);
    expect((await getProject(db, project.id)).revisionsUsed).toBe(1);
    await move(project.id, "client_review");

    // --- Change request (add-on quote, paid separately) ----------------------------
    const cr = await createChangeRequest(db, {
      projectId: project.id,
      description: "إضافة ربط مع Google Sheets",
      requestedBy: "client",
    });
    await assessChangeRequest(db, cr.id, false);
    await expectClient(project.id, "client_review", ["change_request"]);
    await move(project.id, "change_request");
    await expectClient(project.id, "in_progress", ["change_request"]);

    const { quote: addonDraft } = await createQuoteDraft(db, {
      ...draftInput(project.id),
      kind: "addon",
      changeRequestId: cr.id,
      title: "إضافة: ربط Google Sheets",
      lineItems: [{ description: "ربط Google Sheets", unitPriceMinor: 12_000 }],
    });
    expect(addonDraft.paymentPlan.map((m) => [m.kind, m.percent])).toEqual([["addon", 100]]);
    const { quote: addon } = await sendQuote(db, { quoteId: addonDraft.id });
    expect(addon.ref).toBe(ref("Q", 2));
    expect((await getProject(db, project.id)).status).toBe("change_request");

    const addonAccepted = await acceptWithOtp(project.id, addon.id);
    const addonMilestone = addonAccepted.milestones[0];
    if (!addonMilestone) throw new Error("addon milestone missing");
    expect(addonMilestone).toMatchObject({ kind: "addon", sequence: 3, amountMinor: 12_000 });
    const addonPaid = await recordPayment(db, { milestoneId: addonMilestone.id, sales: SALES_ON });
    expect(addonPaid.receipt.ref).toBe(ref("R", 2));
    await resolveChangeRequest(db, cr.id, "done");
    await move(project.id, "in_progress", "internal_qa", "client_review");
    await expectClient(project.id, "client_review");
    expect((await getProject(db, project.id)).priceTotalMinor).toBe(92_000);

    // --- Approval, balance, delivery -------------------------------------------------
    await expect(transitionProject(db, { projectId: project.id, to: "delivered", actor: "admin" })).rejects.toMatchObject({
      code: "milestones_unpaid",
    });
    await move(project.id, "awaiting_balance");
    await expectClient(project.id, "client_review");
    await sendPaymentRequest(db, {
      milestoneId: balance.id,
      payUrl: "https://payoneer.example/request/2",
      provider: "payoneer",
      sales: SALES_ON,
    });
    const balancePaid = await recordPayment(db, { milestoneId: balance.id, sales: SALES_ON });
    expect(balancePaid.receipt.ref).toBe(ref("R", 3));
    expect(balancePaid.receipt.snapshot).toMatchObject({ contractTotalMinor: 92_000, remainingMinor: 0 });

    const delivered = await getProject(db, project.id);
    expect(delivered.status).toBe("delivered");
    expect(delivered.deliveredAt).not.toBeNull();
    expect((await getReleasedFinalDeliverable(db, project.id, finalFile.id)).released).toBe(true);
    await expectClient(project.id, "delivered");

    // --- Warranty and closing ----------------------------------------------------------
    await move(project.id, "warranty");
    const inWarranty = await getProject(db, project.id);
    expect(inWarranty.warrantyEndsAt!.getTime() - inWarranty.deliveredAt!.getTime()).toBeGreaterThanOrEqual(
      30 * 86_400_000 - 5_000,
    );
    await expectClient(project.id, "warranty");
    await move(project.id, "closed", "follow_up");
    const closed = await getProject(db, project.id);
    expect(closed.status).toBe("follow_up");
    expect(closed.closedAt).not.toBeNull();
    const finalView = await expectClient(project.id, "warranty");
    expect(finalView.stages.every((s) => s.state !== "upcoming")).toBe(true);

    // --- Timeline: client sees only client-visible events -----------------------------
    const allEvents = await listProjectEvents(db, project.id);
    const visible = await listProjectEvents(db, project.id, { clientOnly: true });
    expect(visible.length).toBeLessThan(allEvents.length);
    expect(visible.some((e) => e.type === "quote_drafted")).toBe(false);
    expect(visible.some((e) => e.toStatus === "internal_qa")).toBe(false);
    expect(finalView.timeline.length).toBeGreaterThan(10);
    expect(JSON.stringify(finalView)).not.toContain("internal_qa");

    // --- Credit note reverses part of a receipt -----------------------------------------
    const cn = await issueCreditNote(db, { receiptId: addonPaid.receipt.id, reason: "خصم بسبب التأخير", amountMinor: 5_000 });
    expect(cn).toMatchObject({ ref: ref("CN", 1), type: "credit_note", reversesDocumentId: addonPaid.receipt.id });
    await expect(
      issueCreditNote(db, { receiptId: addonPaid.receipt.id, reason: "تجاوز", amountMinor: 7_001 }),
    ).rejects.toMatchObject({ code: "invalid_amount" });

    const refs = (await listProjectDocuments(db, project.id)).map((d) => d.ref).sort();
    expect(refs).toEqual([ref("CN", 1), ref("Q", 1), ref("Q", 2), ref("R", 1), ref("R", 2), ref("R", 3)].sort());
    expect((await listMilestones(db, project.id)).every((m) => m.status === "paid")).toBe(true);

    // --- PDFs (Chromium) ------------------------------------------------------------------
    if (env().CHROMIUM_PATH) {
      const quotePdf = await generateDocumentPdf(db, quoteDoc.id);
      const receiptPdf = await generateDocumentPdf(db, depositPaid.receipt.id);
      for (const { key } of [quotePdf, receiptPdf]) {
        const bytes = await readFile(path.join(env().STORAGE_DIR, key));
        expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
        expect(bytes.includes(Buffer.from("IBMPlexSansArabic"))).toBe(true);
      }
      expect(await generateDocumentPdf(db, quoteDoc.id)).toEqual(quotePdf);
      await expect(
        db.update(documents).set({ pdfKey: "documents/other.pdf" }).where(eq(documents.id, quoteDoc.id)),
      ).rejects.toThrow();
    }
  });
});

describe("side statuses", () => {
  it("pauses and resumes, shows neutral notices, and closes lost leads", async () => {
    const c = await createClient(db, { name: "Omar", email: "omar@example.com", language: "en" });
    const p = await createProject(db, { clientId: c.id, title: "Dashboard" });

    await move(p.id, "on_hold");
    let view = await getClientPortalView(db, p.id, { sales: SALES_ON });
    expect(view.view).toMatchObject({ stage: "received", isClosed: false });
    expect(view.view.notice?.en).toContain("paused");
    await expect(transitionProject(db, { projectId: p.id, to: "quote_draft", actor: "admin" })).rejects.toMatchObject({
      code: "not_allowed",
    });
    await move(p.id, "lead");
    expect((await getProject(db, p.id)).sideFromStatus).toBeNull();

    await transitionProject(db, { projectId: p.id, to: "lost", actor: "admin", note: "no reply in 72h" });
    const lost = await getProject(db, p.id);
    expect(lost).toMatchObject({ status: "lost", lostReason: "no reply in 72h", sideFromStatus: "lead" });
    view = await getClientPortalView(db, p.id, { sales: SALES_ON });
    expect(view.view.isClosed).toBe(true);
    await expect(transitionProject(db, { projectId: p.id, to: "lead", actor: "admin" })).rejects.toMatchObject({
      code: "not_allowed",
    });

    const events = await db
      .select()
      .from(projectEvents)
      .where(and(eq(projectEvents.projectId, p.id), eq(projectEvents.toStatus, "lost")));
    expect(events[0]?.visibleToClient).toBe(true);
    const [row] = await db.select().from(projects).where(eq(projects.id, p.id));
    expect(row?.status).toBe("lost");
  });
});
