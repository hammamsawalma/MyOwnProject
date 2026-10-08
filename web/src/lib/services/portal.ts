import { and, desc, eq, inArray } from "drizzle-orm";
import { brand, whatsappUrl } from "@/config/brand";
import { isolate, ltr } from "@/lib/bidi";
import type { Db } from "@/db/client";
import {
  clients,
  deliverables,
  documents,
  otpCodes,
  paymentMilestones,
  projectEvents,
  quoteLineItems,
  quotes,
} from "@/db/schema";
import type { OtpPurpose, QuoteStatus } from "@/lib/domain-enums";
import { deliverEmail, type SendEmailOptions } from "@/lib/email/send";
import { otpEmail, portalLinkEmail } from "@/lib/email/templates";
import { DomainError, NotFoundError } from "@/lib/errors";
import { createMagicLink, revokeMagicLink, revokeProjectMagicLinks } from "@/lib/magic-links";
import { formatMoney, type Currency } from "@/lib/money";
import { issueOtp } from "@/lib/otp";
import {
  canReleaseFinalDeliverables,
  isAgreedMilestone,
  MILESTONE_KIND_LABELS,
  type MilestoneKind,
  type MilestoneStatus,
} from "@/lib/payment-plan";
import {
  CLIENT_STAGES,
  CLIENT_STAGE_LABELS,
  clientView,
  isMainStatus,
  type ClientStage,
  type ClientView,
  type ProjectStatus,
} from "@/lib/project-status";
import { clientPaymentPolicy, getSalesConfig, redactPaymentLink, type ClientPaymentPolicy, type SalesConfig } from "@/lib/sales";
import type { Localized } from "@/lib/types";
import { countOpenChangeRequests, getProject } from "./projects";
import { acceptanceBlocker, validUntilDate } from "./quotes";

/**
 * Everything the client tracking page may show, already filtered: no internal
 * statuses, notes, drafts, storage keys, or payment links while sales are off.
 */
export interface ClientPortalView {
  project: { ref: string; title: string };
  client: { name: string; language: "ar" | "en" };
  view: ClientView;
  stages: { key: ClientStage; label: Localized; state: "done" | "current" | "upcoming" }[];
  timeline: { at: string; message: Localized }[];
  quotes: {
    id: string;
    ref: string;
    version: number;
    status: QuoteStatus;
    title: string;
    summary: string | null;
    currency: Currency;
    subtotalMinor: number;
    discountMinor: number;
    totalMinor: number;
    validUntil: string | null;
    scopeIncluded: string[];
    scopeExcluded: string[];
    assumptions: string[];
    acceptanceCriteria: string[];
    timeline: string | null;
    thirdPartyCosts: string | null;
    termsVersion: string | null;
    revisionsIncluded: number;
    warrantyDays: number;
    lines: { description: string; quantity: number; unitPriceMinor: number; totalMinor: number }[];
    paymentPlan: { kind: MilestoneKind; percent: number; amountMinor: number }[];
    acceptedAt: string | null;
    documentId: string | null;
    /** Sales on, quote open, not expired and the project at a stage where it can be accepted. */
    canAccept: boolean;
  }[];
  payments: {
    id: string;
    kind: MilestoneKind;
    label: Localized;
    amountMinor: number;
    currency: Currency;
    status: MilestoneStatus;
    payUrl: string | null;
    paidAt: string | null;
    receiptDocumentId: string | null;
  }[];
  paymentPolicy: ClientPaymentPolicy;
  deliverables: {
    id: string;
    kind: "preview" | "final";
    title: string;
    released: boolean;
    hasFile: boolean;
    externalUrl: string | null;
  }[];
  contact: { email: string; whatsappUrl: string | null };
}

type EventForMessage = Pick<typeof projectEvents.$inferSelect, "type" | "toStatus" | "fromStatus" | "payload">;

/**
 * The text the client sees for a timeline event, or null when the event type
 * has no client-facing wording (it then never appears on the tracking page,
 * even if marked visible). Also used by the admin timeline as a preview.
 */
export function clientTimelineMessage(event: EventForMessage): Localized | null {
  return timelineMessage(event, event.fromStatus);
}

function timelineMessage(event: EventForMessage, sideFromAtEvent: ProjectStatus | null): Localized | null {
  const p = event.payload as Record<string, unknown>;
  switch (event.type) {
    case "project_created":
      return { ar: "استلمنا طلبك.", en: "We received your request." };
    case "status_changed": {
      if (!event.toStatus) return null;
      const sideFrom = sideFromAtEvent && isMainStatus(sideFromAtEvent) ? sideFromAtEvent : null;
      const v = clientView(event.toStatus, { sideFrom });
      if (v.notice) return v.notice;
      if (!v.stageLabel) return null;
      return { ar: `انتقل المشروع إلى: ${v.stageLabel.ar}`, en: `Project moved to: ${v.stageLabel.en}` };
    }
    case "quote_sent":
      return { ar: `أرسلنا عرض السعر ${ltr(String(p.ref ?? ""))}.`, en: `Quote ${String(p.ref ?? "")} was sent.` };
    case "quote_accepted":
      return { ar: `تم قبول عرض السعر ${ltr(String(p.ref ?? ""))}.`, en: `Quote ${String(p.ref ?? "")} was accepted.` };
    case "payment_requested":
      return { ar: "أُرسل طلب دفعة.", en: "A payment request was sent." };
    case "payment_recorded": {
      if (typeof p.amountMinor !== "number" || (p.currency !== "USD" && p.currency !== "EUR")) {
        return { ar: "استلمنا دفعة.", en: "Payment received." };
      }
      return {
        ar: `استلمنا دفعة بقيمة ${ltr(formatMoney(p.amountMinor, p.currency, "ar"))}.`,
        en: `Payment received: ${formatMoney(p.amountMinor, p.currency, "en")}.`,
      };
    }
    case "change_request_created":
      return { ar: "سجّلنا طلب إضافة.", en: "A change request was logged." };
    case "client_update": {
      const text = typeof p.text === "string" ? p.text.trim() : "";
      return text ? { ar: text, en: text } : null;
    }
    case "deliverable_added": {
      if (p.kind !== "preview" || typeof p.title !== "string") return null;
      return { ar: `أضفنا معاينة جديدة: ${isolate(p.title)}`, en: `New preview available: ${isolate(p.title)}` };
    }
    default:
      return null;
  }
}

export async function getClientPortalView(
  db: Db,
  projectId: string,
  options: { sales?: SalesConfig } = {},
): Promise<ClientPortalView> {
  const sales = options.sales ?? getSalesConfig();
  const project = await getProject(db, projectId);
  const [client] = await db.select().from(clients).where(eq(clients.id, project.clientId));
  if (!client) throw new NotFoundError("client", project.clientId);

  const openChangeRequests = await countOpenChangeRequests(db, projectId);
  const view = clientView(project.status, { sideFrom: project.sideFromStatus, openChangeRequests });
  const stages = CLIENT_STAGES.map((key, i) => ({
    key,
    label: CLIENT_STAGE_LABELS[key],
    state: (view.stageIndex === null || i > view.stageIndex ? "upcoming" : i === view.stageIndex ? "current" : "done") as
      | "done"
      | "current"
      | "upcoming",
  }));

  const events = await db
    .select()
    .from(projectEvents)
    .where(and(eq(projectEvents.projectId, projectId), eq(projectEvents.visibleToClient, true)))
    .orderBy(projectEvents.seq);
  const timeline = events
    .map((event) => ({ at: event.createdAt.toISOString(), message: clientTimelineMessage(event) }))
    .filter((t): t is { at: string; message: Localized } => t.message !== null);

  const issued = await db
    .select()
    .from(quotes)
    .where(and(eq(quotes.projectId, projectId), inArray(quotes.status, ["sent", "accepted", "expired"])))
    .orderBy(desc(quotes.version));
  const docs = await db.select().from(documents).where(eq(documents.projectId, projectId));
  const today = validUntilDate(new Date(), 0);
  const quoteViews = [];
  for (const q of issued) {
    // expireQuotes() is not scheduled yet: a sent quote past its date is shown as expired.
    const expired = q.status === "sent" && q.validUntil !== null && q.validUntil < today;
    const lines = await db
      .select()
      .from(quoteLineItems)
      .where(eq(quoteLineItems.quoteId, q.id))
      .orderBy(quoteLineItems.position);
    quoteViews.push({
      id: q.id,
      ref: q.ref ?? "",
      version: q.version,
      status: expired ? ("expired" as const) : q.status,
      title: q.title,
      summary: q.summary,
      currency: q.currency,
      subtotalMinor: q.subtotalMinor,
      discountMinor: q.discountMinor,
      totalMinor: q.totalMinor,
      validUntil: q.validUntil,
      scopeIncluded: q.scopeIncluded,
      scopeExcluded: q.scopeExcluded,
      assumptions: q.assumptions,
      acceptanceCriteria: q.acceptanceCriteria,
      timeline: q.timeline,
      thirdPartyCosts: q.thirdPartyCosts,
      termsVersion: q.termsVersion,
      revisionsIncluded: q.revisionsIncluded,
      warrantyDays: q.warrantyDays,
      lines: lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
        totalMinor: l.totalMinor,
      })),
      paymentPlan: q.paymentPlan.map((m) => ({ kind: m.kind, percent: m.percent, amountMinor: m.amountMinor })),
      acceptedAt: q.acceptedAt?.toISOString() ?? null,
      documentId: docs.find((d) => d.type === "quote_pdf" && d.quoteId === q.id)?.id ?? null,
      canAccept: sales.salesEnabled && acceptanceBlocker(q, project, today) === null,
    });
  }

  const milestones = await db
    .select()
    .from(paymentMilestones)
    .where(eq(paymentMilestones.projectId, projectId))
    .orderBy(paymentMilestones.sequence);
  // Drafts the admin is still preparing stay hidden; drafts created from an
  // accepted quote are the agreed schedule and are shown.
  const acceptedQuoteIds = new Set(issued.filter((q) => q.status === "accepted").map((q) => q.id));
  const visibleMilestones = milestones.filter((m) => isAgreedMilestone(m, acceptedQuoteIds));
  const payments = visibleMilestones.map((m) => {
    const safe = redactPaymentLink(m, sales);
    return {
      id: m.id,
      kind: m.kind,
      label: MILESTONE_KIND_LABELS[m.kind],
      amountMinor: m.amountMinor,
      currency: m.currency,
      status: m.status,
      payUrl: safe.payUrl,
      paidAt: m.paidAt?.toISOString() ?? null,
      receiptDocumentId: docs.find((d) => d.type === "receipt" && d.milestoneId === m.id)?.id ?? null,
    };
  });

  const files = await db
    .select()
    .from(deliverables)
    .where(eq(deliverables.projectId, projectId))
    .orderBy(deliverables.createdAt);
  // A refund or dispute after delivery locks the final files again.
  const finalsPaid = canReleaseFinalDeliverables(milestones);
  const isOpen = (f: (typeof files)[number]) => f.released && (f.kind === "preview" || finalsPaid);

  return {
    project: { ref: project.ref, title: project.title },
    client: { name: client.name, language: client.language },
    view,
    stages,
    timeline,
    quotes: quoteViews,
    payments,
    paymentPolicy: clientPaymentPolicy(sales),
    // Finals are listed (so the client knows they exist) but only linked once released.
    deliverables: files.map((f) => ({
      id: f.id,
      kind: f.kind,
      title: f.title,
      released: isOpen(f),
      hasFile: f.fileKey !== null,
      externalUrl: isOpen(f) ? f.externalUrl : null,
    })),
    contact: { email: brand.contact.email, whatsappUrl: whatsappUrl() },
  };
}

/**
 * Issues an OTP for a sensitive portal action and emails it to the client. If
 * the email cannot be delivered the code is voided and "email_failed" thrown,
 * so the client is never told a code is on its way when it is not.
 */
export async function requestClientOtp(
  db: Db,
  input: { projectId: string; purpose: OtpPurpose; magicLinkId?: string | null; now?: Date; email?: SendEmailOptions },
): Promise<{ ok: true; expiresAt: Date; sentTo: string } | { ok: false; reason: "rate_limited"; retryAt: Date }> {
  const project = await getProject(db, input.projectId);
  const [client] = await db.select().from(clients).where(eq(clients.id, project.clientId));
  if (!client?.email) throw new DomainError("client_email_missing", "The client has no email address on file");

  const issued = await issueOtp(db, {
    projectId: project.id,
    purpose: input.purpose,
    email: client.email,
    magicLinkId: input.magicLinkId,
    now: input.now,
  });
  if (!issued.ok) return issued;

  const email = otpEmail({
    locale: client.language,
    code: issued.code,
    purpose: input.purpose,
    projectTitle: project.title,
    clientName: client.name,
  });
  try {
    await deliverEmail(db, { to: client.email, ...email, tag: "otp", projectId: project.id }, input.email);
  } catch (err) {
    await db
      .update(otpCodes)
      .set({ invalidatedAt: input.now ?? new Date() })
      .where(eq(otpCodes.id, issued.otpId));
    throw err;
  }
  return { ok: true, expiresAt: issued.expiresAt, sentTo: maskEmail(client.email) };
}

/**
 * Creates a fresh magic link and emails it to the client. Older links are
 * revoked only once the email was accepted; if delivery fails the new link is
 * revoked instead and the client keeps the link they already have.
 */
export async function sendPortalLink(db: Db, input: { projectId: string; ttlDays?: number; email?: SendEmailOptions }) {
  const project = await getProject(db, input.projectId);
  const [client] = await db.select().from(clients).where(eq(clients.id, project.clientId));
  if (!client?.email) throw new DomainError("client_email_missing", "The client has no email address on file");
  const link = await createMagicLink(db, { projectId: project.id, ttlDays: input.ttlDays });
  // The tracking page defaults to Arabic; English-speaking clients get the English view.
  const url = client.language === "en" ? `${link.url}?lang=en` : link.url;
  const email = portalLinkEmail({ locale: client.language, url, projectTitle: project.title, clientName: client.name });
  try {
    await deliverEmail(db, { to: client.email, ...email, tag: "portal_link", projectId: project.id }, input.email);
  } catch (err) {
    await revokeMagicLink(db, link.id);
    throw err;
  }
  await revokeProjectMagicLinks(db, project.id, { except: link.id });
  return link;
}

export function maskEmail(email: string): string {
  const [user = "", domain = ""] = email.split("@");
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}${"*".repeat(Math.max(1, user.length - visible.length))}@${domain}`;
}
