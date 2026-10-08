import { and, desc, eq, inArray } from "drizzle-orm";
import { brand, whatsappUrl } from "@/config/brand";
import type { Db } from "@/db/client";
import { clients, deliverables, documents, paymentMilestones, projectEvents, quoteLineItems, quotes } from "@/db/schema";
import type { OtpPurpose } from "@/lib/domain-enums";
import { sendEmail } from "@/lib/email/send";
import { otpEmail, portalLinkEmail } from "@/lib/email/templates";
import { DomainError, NotFoundError } from "@/lib/errors";
import { createMagicLink } from "@/lib/magic-links";
import { formatMoney, type Currency } from "@/lib/money";
import { issueOtp } from "@/lib/otp";
import { MILESTONE_KIND_LABELS, type MilestoneKind, type MilestoneStatus } from "@/lib/payment-plan";
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
    status: string;
    title: string;
    summary: string | null;
    currency: Currency;
    subtotalMinor: number;
    discountMinor: number;
    totalMinor: number;
    validUntil: string | null;
    scopeIncluded: string[];
    scopeExcluded: string[];
    revisionsIncluded: number;
    warrantyDays: number;
    lines: { description: string; quantity: number; unitPriceMinor: number; totalMinor: number }[];
    paymentPlan: { kind: MilestoneKind; percent: number; amountMinor: number }[];
    acceptedAt: string | null;
    documentId: string | null;
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
  deliverables: { id: string; kind: "preview" | "final"; title: string; released: boolean; externalUrl: string | null }[];
  contact: { email: string; whatsappUrl: string | null };
}

function timelineMessage(
  event: typeof projectEvents.$inferSelect,
  sideFromAtEvent: ProjectStatus | null,
): Localized | null {
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
      return { ar: `أرسلنا عرض السعر ${String(p.ref ?? "")}.`, en: `Quote ${String(p.ref ?? "")} was sent.` };
    case "quote_accepted":
      return { ar: `تم قبول عرض السعر ${String(p.ref ?? "")}.`, en: `Quote ${String(p.ref ?? "")} was accepted.` };
    case "payment_requested":
      return { ar: "أُرسل طلب دفعة.", en: "A payment request was sent." };
    case "payment_recorded": {
      if (typeof p.amountMinor !== "number" || (p.currency !== "USD" && p.currency !== "EUR")) {
        return { ar: "استلمنا دفعة.", en: "Payment received." };
      }
      return {
        ar: `استلمنا دفعة بقيمة ${formatMoney(p.amountMinor, p.currency, "ar")}.`,
        en: `Payment received: ${formatMoney(p.amountMinor, p.currency, "en")}.`,
      };
    }
    case "change_request_created":
      return { ar: "سجّلنا طلب إضافة.", en: "A change request was logged." };
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
    .map((event) => ({ at: event.createdAt.toISOString(), message: timelineMessage(event, event.fromStatus) }))
    .filter((t): t is { at: string; message: Localized } => t.message !== null);

  const issued = await db
    .select()
    .from(quotes)
    .where(and(eq(quotes.projectId, projectId), inArray(quotes.status, ["sent", "accepted", "expired"])))
    .orderBy(desc(quotes.version));
  const docs = await db.select().from(documents).where(eq(documents.projectId, projectId));
  const quoteViews = [];
  for (const q of issued) {
    const lines = await db
      .select()
      .from(quoteLineItems)
      .where(eq(quoteLineItems.quoteId, q.id))
      .orderBy(quoteLineItems.position);
    quoteViews.push({
      id: q.id,
      ref: q.ref ?? "",
      version: q.version,
      status: q.status,
      title: q.title,
      summary: q.summary,
      currency: q.currency,
      subtotalMinor: q.subtotalMinor,
      discountMinor: q.discountMinor,
      totalMinor: q.totalMinor,
      validUntil: q.validUntil,
      scopeIncluded: q.scopeIncluded,
      scopeExcluded: q.scopeExcluded,
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
    });
  }

  const milestones = await db
    .select()
    .from(paymentMilestones)
    .where(eq(paymentMilestones.projectId, projectId))
    .orderBy(paymentMilestones.sequence);
  const payments = milestones.map((m) => {
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
      released: f.released,
      externalUrl: f.released ? f.externalUrl : null,
    })),
    contact: { email: brand.contact.email, whatsappUrl: whatsappUrl() },
  };
}

/** Issues an OTP for a sensitive portal action and emails it to the client. */
export async function requestClientOtp(
  db: Db,
  input: { projectId: string; purpose: OtpPurpose; magicLinkId?: string | null; now?: Date },
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

  const email = otpEmail({ locale: client.language, code: issued.code, purpose: input.purpose, projectTitle: project.title });
  await sendEmail(db, { to: client.email, ...email, tag: "otp", projectId: project.id });
  return { ok: true, expiresAt: issued.expiresAt, sentTo: maskEmail(client.email) };
}

/** Creates a fresh magic link (revoking older ones) and emails it to the client. */
export async function sendPortalLink(db: Db, input: { projectId: string; ttlDays?: number }) {
  const project = await getProject(db, input.projectId);
  const [client] = await db.select().from(clients).where(eq(clients.id, project.clientId));
  if (!client?.email) throw new DomainError("client_email_missing", "The client has no email address on file");
  const link = await createMagicLink(db, { projectId: project.id, ttlDays: input.ttlDays, revokeExisting: true });
  const email = portalLinkEmail({ locale: client.language, url: link.url, projectTitle: project.title });
  await sendEmail(db, { to: client.email, ...email, tag: "portal_link", projectId: project.id });
  return link;
}

export function maskEmail(email: string): string {
  const [user = "", domain = ""] = email.split("@");
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}${"*".repeat(Math.max(1, user.length - visible.length))}@${domain}`;
}
