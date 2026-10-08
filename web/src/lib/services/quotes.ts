import { and, eq, inArray, lt, max, ne } from "drizzle-orm";
import { z } from "zod";
import { env } from "@/config/env";
import { policy } from "@/config/policy";
import type { Db } from "@/db/client";
import {
  changeRequests,
  clients,
  consents,
  paymentMilestones,
  projects as projectsTable,
  quoteLineItems,
  quotes,
} from "@/db/schema";
import { PACKAGE_TIERS, PRICING_MODELS, QUOTE_KINDS, type EventActor } from "@/lib/domain-enums";
import { DomainError, NotFoundError } from "@/lib/errors";
import { CURRENCIES, lineTotal, sumMinor } from "@/lib/money";
import { allocateNumber, NUMBER_SERIES } from "@/lib/numbering";
import { verifyOtp } from "@/lib/otp";
import {
  assertPlanMatchesTotal,
  defaultPaymentPlan,
  MILESTONE_KINDS,
  MILESTONE_KIND_LABELS,
  type PlannedMilestone,
} from "@/lib/payment-plan";
import { isSideStatus } from "@/lib/project-status";
import { assertSalesEnabled, getSalesConfig, type SalesConfig } from "@/lib/sales";
import { getPaymentPolicy } from "@/lib/settings";
import { issueQuoteDocumentInTx, type DocumentRow } from "./documents";
import { addProjectEvent, getProject, transitionProject } from "./projects";

export type QuoteRow = typeof quotes.$inferSelect;
export type QuoteLineItemRow = typeof quoteLineItems.$inferSelect;

const LineItemInput = z.object({
  description: z.string().trim().min(1),
  quantity: z.number().int().positive().default(1),
  unitPriceMinor: z.number().int().nonnegative(),
});

const PlannedMilestoneInput = z.object({
  kind: z.enum(MILESTONE_KINDS),
  sequence: z.number().int().positive(),
  percent: z.number().int().min(0).max(100),
  amountMinor: z.number().int().positive(),
});

const textList = z.array(z.string().trim().min(1)).default([]);

export const QuoteDraftInput = z.object({
  projectId: z.uuid(),
  kind: z.enum(QUOTE_KINDS).default("initial"),
  changeRequestId: z.uuid().nullish(),
  pricingModel: z.enum(PRICING_MODELS).default("custom"),
  packageTier: z.enum(PACKAGE_TIERS).nullish(),
  currency: z.enum(CURRENCIES),
  title: z.string().trim().min(1),
  summary: z.string().nullish(),
  scopeIncluded: textList,
  scopeExcluded: textList,
  assumptions: textList,
  acceptanceCriteria: textList,
  timeline: z.string().nullish(),
  revisionsIncluded: z.number().int().min(0).default(0),
  warrantyDays: z.number().int().min(0).default(0),
  thirdPartyCosts: z.string().nullish(),
  notes: z.string().nullish(),
  discountMinor: z.number().int().nonnegative().default(0),
  lineItems: z.array(LineItemInput).min(1),
  /** Optional manual plan; defaults to the payment policy. Must sum to the total. */
  paymentPlan: z.array(PlannedMilestoneInput).nullish(),
});

export type QuoteDraftInput = z.input<typeof QuoteDraftInput>;

async function computeDraft(db: Db, data: z.output<typeof QuoteDraftInput>) {
  const lines = data.lineItems.map((l, i) => ({
    position: i + 1,
    description: l.description,
    quantity: l.quantity,
    unitPriceMinor: l.unitPriceMinor,
    totalMinor: lineTotal(l.quantity, l.unitPriceMinor),
  }));
  const subtotalMinor = sumMinor(lines.map((l) => l.totalMinor));
  if (data.discountMinor > subtotalMinor) throw new DomainError("invalid_amount", "Discount exceeds subtotal");
  const totalMinor = subtotalMinor - data.discountMinor;
  const plan: PlannedMilestone[] =
    data.paymentPlan ??
    defaultPaymentPlan(totalMinor, data.currency, await getPaymentPolicy(db), data.kind === "addon" ? "addon" : "project");
  assertPlanMatchesTotal(plan, totalMinor);
  return { lines, subtotalMinor, totalMinor, plan };
}

function quoteValues(data: z.output<typeof QuoteDraftInput>) {
  return {
    kind: data.kind,
    pricingModel: data.pricingModel,
    packageTier: data.packageTier ?? null,
    currency: data.currency,
    title: data.title,
    summary: data.summary ?? null,
    scopeIncluded: data.scopeIncluded,
    scopeExcluded: data.scopeExcluded,
    assumptions: data.assumptions,
    acceptanceCriteria: data.acceptanceCriteria,
    timeline: data.timeline ?? null,
    revisionsIncluded: data.revisionsIncluded,
    warrantyDays: data.warrantyDays,
    thirdPartyCosts: data.thirdPartyCosts ?? null,
    notes: data.notes ?? null,
    discountMinor: data.discountMinor,
  };
}

export async function createQuoteDraft(
  db: Db,
  input: QuoteDraftInput,
  options: { actor?: EventActor; now?: Date } = {},
): Promise<{ quote: QuoteRow; lineItems: QuoteLineItemRow[] }> {
  const data = QuoteDraftInput.parse(input);
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    await getProject(tx, data.projectId, { forUpdate: true });
    const { lines, subtotalMinor, totalMinor, plan } = await computeDraft(tx, data);
    const [last] = await tx
      .select({ version: max(quotes.version) })
      .from(quotes)
      .where(eq(quotes.projectId, data.projectId));

    const [quote] = await tx
      .insert(quotes)
      .values({
        ...quoteValues(data),
        projectId: data.projectId,
        version: (last?.version ?? 0) + 1,
        status: "draft",
        subtotalMinor,
        totalMinor,
        paymentPlan: plan,
        createdAt: now,
      })
      .returning();
    if (!quote) throw new Error("quote insert failed");
    const lineItems = await tx
      .insert(quoteLineItems)
      .values(lines.map((l) => ({ ...l, quoteId: quote.id })))
      .returning();

    if (data.changeRequestId) {
      await tx
        .update(changeRequests)
        .set({ quoteId: quote.id, inScope: false })
        .where(and(eq(changeRequests.id, data.changeRequestId), eq(changeRequests.projectId, data.projectId)));
    }
    await addProjectEvent(tx, {
      projectId: data.projectId,
      type: "quote_drafted",
      actor: options.actor ?? "admin",
      payload: { quoteId: quote.id, version: quote.version, totalMinor, currency: quote.currency },
      now,
    });
    return { quote, lineItems };
  });
}

/** Replaces the content of a draft quote (issued quotes are immutable). */
export async function updateQuoteDraft(
  db: Db,
  quoteId: string,
  input: QuoteDraftInput,
): Promise<{ quote: QuoteRow; lineItems: QuoteLineItemRow[] }> {
  const data = QuoteDraftInput.parse(input);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(quotes).where(eq(quotes.id, quoteId)).for("update");
    if (!existing) throw new NotFoundError("quote", quoteId);
    if (existing.status !== "draft") throw new DomainError("quote_not_draft", "Only draft quotes can be edited");
    if (existing.projectId !== data.projectId) throw new DomainError("invalid_input", "Quote belongs to another project");

    const { lines, subtotalMinor, totalMinor, plan } = await computeDraft(tx, data);
    await tx.delete(quoteLineItems).where(eq(quoteLineItems.quoteId, quoteId));
    const [quote] = await tx
      .update(quotes)
      .set({ ...quoteValues(data), subtotalMinor, totalMinor, paymentPlan: plan, updatedAt: new Date() })
      .where(eq(quotes.id, quoteId))
      .returning();
    if (!quote) throw new Error("quote update failed");
    const lineItems = await tx
      .insert(quoteLineItems)
      .values(lines.map((l) => ({ ...l, quoteId })))
      .returning();
    return { quote, lineItems };
  });
}

/**
 * A new initial version replaces an earlier accepted one (renegotiation before
 * any payment): its draft milestones are removed and it is marked superseded.
 * Once money moved on it, scope changes must go through add-on quotes instead.
 */
async function retirePreviouslyAcceptedQuotes(tx: Db, projectId: string): Promise<void> {
  const accepted = await tx
    .select({ id: quotes.id })
    .from(quotes)
    .where(and(eq(quotes.projectId, projectId), eq(quotes.kind, "initial"), eq(quotes.status, "accepted")));
  if (accepted.length === 0) return;
  const ids = accepted.map((q) => q.id);
  const linked = await tx
    .select({ status: paymentMilestones.status })
    .from(paymentMilestones)
    .where(inArray(paymentMilestones.quoteId, ids));
  if (linked.some((m) => m.status !== "draft")) {
    throw new DomainError("initial_quote_has_payments", "The accepted quote already has payment activity; use an add-on quote");
  }
  await tx.delete(paymentMilestones).where(inArray(paymentMilestones.quoteId, ids));
  await tx.update(quotes).set({ status: "superseded" }).where(inArray(quotes.id, ids));
}

/** Date `days` after `now`, as YYYY-MM-DD in the business time zone. */
export function validUntilDate(now: Date, days: number, timeZone: string = env().BUSINESS_TIMEZONE): string {
  const target = new Date(now.getTime() + days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(target);
}

/**
 * Issues a draft quote: assigns Q-YYYY-NNNN (gapless), freezes it, writes the
 * quote_pdf document and moves the project to quote_sent (initial quotes).
 * Sending a quote is allowed while sales are disabled; accepting it is not.
 */
export async function sendQuote(
  db: Db,
  input: { quoteId: string; actor?: EventActor; now?: Date; validityDays?: number },
): Promise<{ quote: QuoteRow; document: DocumentRow }> {
  const now = input.now ?? new Date();
  const actor = input.actor ?? "admin";
  return db.transaction(async (tx) => {
    const [draft] = await tx.select().from(quotes).where(eq(quotes.id, input.quoteId)).for("update");
    if (!draft) throw new NotFoundError("quote", input.quoteId);
    if (draft.status !== "draft") throw new DomainError("quote_not_draft", "Quote was already sent");
    const project = await getProject(tx, draft.projectId, { forUpdate: true });
    const [client] = await tx.select().from(clients).where(eq(clients.id, project.clientId));
    if (!client) throw new NotFoundError("client", project.clientId);

    if (draft.kind === "initial") {
      if (!["quote_draft", "quote_sent"].includes(project.status)) {
        throw new DomainError("invalid_project_status", `Cannot send an initial quote while project is ${project.status}`);
      }
      await retirePreviouslyAcceptedQuotes(tx, project.id);
    }

    // A newer version replaces any outstanding (not yet accepted) quote of the same kind.
    await tx
      .update(quotes)
      .set({ status: "superseded" })
      .where(
        and(
          eq(quotes.projectId, project.id),
          eq(quotes.kind, draft.kind),
          eq(quotes.status, "sent"),
          ne(quotes.id, draft.id),
        ),
      );

    const { ref } = await allocateNumber(tx, NUMBER_SERIES.quote, { date: now });
    const [quote] = await tx
      .update(quotes)
      .set({
        status: "sent",
        ref,
        sentAt: now,
        validUntil: validUntilDate(now, input.validityDays ?? policy.quoteValidityDays),
        termsVersion: policy.termsVersion,
        updatedAt: now,
      })
      .where(eq(quotes.id, draft.id))
      .returning();
    if (!quote) throw new Error("quote update failed");

    const document = await issueQuoteDocumentInTx(tx, { quote, project, client, now });

    if (quote.kind === "initial" && project.status === "quote_draft") {
      await transitionProject(tx, { projectId: project.id, to: "quote_sent", actor, now });
    }
    if (quote.kind === "addon") {
      await tx.update(changeRequests).set({ status: "quoted" }).where(eq(changeRequests.quoteId, quote.id));
    }
    await addProjectEvent(tx, {
      projectId: project.id,
      type: "quote_sent",
      actor,
      visibleToClient: true,
      payload: { quoteId: quote.id, ref, totalMinor: quote.totalMinor, currency: quote.currency },
      now,
    });
    return { quote, document };
  });
}

export interface AcceptQuoteInput {
  projectId: string;
  quoteId: string;
  otpCode: string;
  termsAccepted: boolean;
  /** The explicit "start immediately / waive EU withdrawal right" checkbox. */
  startImmediatelyWaiver: boolean;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
  sales?: SalesConfig;
  secret?: string;
}

export type AcceptQuoteResult = { quote: QuoteRow; milestones: (typeof paymentMilestones.$inferSelect)[] };

/**
 * Client accepts a sent quote from the portal: requires sales enabled, a valid
 * OTP, the terms checkbox and the start-immediately waiver. Records consents
 * (terms version, IP, user agent, time), creates draft payment milestones from
 * the quote's plan and moves the project to awaiting_deposit.
 */
export async function acceptQuote(db: Db, input: AcceptQuoteInput): Promise<AcceptQuoteResult> {
  const now = input.now ?? new Date();
  assertSalesEnabled("accept_quote", input.sales ?? getSalesConfig());
  if (!input.termsAccepted) throw new DomainError("terms_required", "Terms must be accepted");
  if (policy.requireStartImmediatelyWaiver && !input.startImmediatelyWaiver) {
    throw new DomainError("waiver_required", "The start-immediately / withdrawal waiver checkbox is required");
  }

  const [candidate] = await db.select().from(quotes).where(eq(quotes.id, input.quoteId));
  if (!candidate || candidate.projectId !== input.projectId) throw new NotFoundError("quote", input.quoteId);
  if (candidate.status !== "sent") throw new DomainError("quote_not_open", `Quote is ${candidate.status}`);

  const otp = await verifyOtp(db, {
    projectId: input.projectId,
    purpose: "accept_quote",
    code: input.otpCode,
    now,
    secret: input.secret,
  });
  if (!otp.ok) throw new DomainError(`otp_${otp.reason}`, "Verification code rejected", { attemptsLeft: otp.attemptsLeft });

  return db.transaction(async (tx) => {
    const [quote] = await tx.select().from(quotes).where(eq(quotes.id, input.quoteId)).for("update");
    if (!quote || quote.status !== "sent") throw new DomainError("quote_not_open", "Quote is no longer open");
    const today = validUntilDate(now, 0);
    if (quote.validUntil && quote.validUntil < today) throw new DomainError("quote_expired", "Quote has expired");
    const project = await getProject(tx, quote.projectId, { forUpdate: true });
    if (quote.kind === "initial" && project.status !== "quote_sent") {
      throw new DomainError("invalid_project_status", `Cannot accept the quote while project is ${project.status}`);
    }
    if (quote.kind === "addon" && (isSideStatus(project.status) || project.status === "follow_up")) {
      throw new DomainError("invalid_project_status", `Cannot accept an add-on while project is ${project.status}`);
    }

    const [accepted] = await tx
      .update(quotes)
      .set({
        status: "accepted",
        acceptedAt: now,
        acceptedIp: input.ip ?? null,
        acceptedUserAgent: input.userAgent?.slice(0, 500) ?? null,
        acceptedTermsVersion: quote.termsVersion,
        updatedAt: now,
      })
      .where(eq(quotes.id, quote.id))
      .returning();
    if (!accepted) throw new Error("quote update failed");

    const consentBase = {
      clientId: project.clientId,
      projectId: project.id,
      quoteId: quote.id,
      version: quote.termsVersion ?? policy.termsVersion,
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 500) ?? null,
      createdAt: now,
    };
    await tx.insert(consents).values([
      { ...consentBase, kind: "terms", granted: true },
      { ...consentBase, kind: "eu_withdrawal_waiver", granted: input.startImmediatelyWaiver },
    ]);

    const existing = await tx
      .select({ sequence: paymentMilestones.sequence })
      .from(paymentMilestones)
      .where(eq(paymentMilestones.projectId, project.id));
    const offset = existing.reduce((acc, m) => Math.max(acc, m.sequence), 0);
    const milestones = await tx
      .insert(paymentMilestones)
      .values(
        quote.paymentPlan.map((m) => ({
          projectId: project.id,
          quoteId: quote.id,
          kind: m.kind,
          sequence: offset + m.sequence,
          label: MILESTONE_KIND_LABELS[m.kind].ar,
          amountMinor: m.amountMinor,
          currency: quote.currency,
          status: "draft" as const,
          createdAt: now,
        })),
      )
      .returning();

    if (quote.kind === "initial") {
      await tx
        .update(projectsTable)
        .set({
          currency: quote.currency,
          priceTotalMinor: quote.totalMinor,
          revisionsIncluded: quote.revisionsIncluded,
          warrantyDays: quote.warrantyDays,
          pricingModel: quote.pricingModel,
          packageTier: quote.packageTier,
          updatedAt: now,
        })
        .where(eq(projectsTable.id, project.id));
    } else {
      await tx
        .update(projectsTable)
        .set({ priceTotalMinor: (project.priceTotalMinor ?? 0) + quote.totalMinor, updatedAt: now })
        .where(eq(projectsTable.id, project.id));
      await tx.update(changeRequests).set({ status: "accepted" }).where(eq(changeRequests.quoteId, quote.id));
    }

    await addProjectEvent(tx, {
      projectId: project.id,
      type: "quote_accepted",
      actor: "client",
      visibleToClient: true,
      payload: { quoteId: quote.id, ref: quote.ref, termsVersion: quote.termsVersion },
      now,
    });
    if (quote.kind === "initial") {
      await transitionProject(tx, { projectId: project.id, to: "awaiting_deposit", actor: "client", now });
    }
    return { quote: accepted, milestones };
  });
}

/** Marks sent quotes past their validity date as expired. Returns how many. */
export async function expireQuotes(db: Db, now: Date = new Date()): Promise<number> {
  const today = validUntilDate(now, 0);
  const rows = await db
    .update(quotes)
    .set({ status: "expired", updatedAt: now })
    .where(and(eq(quotes.status, "sent"), lt(quotes.validUntil, today)))
    .returning({ id: quotes.id });
  return rows.length;
}

export async function getQuoteWithLines(db: Db, quoteId: string) {
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
  if (!quote) throw new NotFoundError("quote", quoteId);
  const lineItems = await db
    .select()
    .from(quoteLineItems)
    .where(eq(quoteLineItems.quoteId, quoteId))
    .orderBy(quoteLineItems.position);
  return { quote, lineItems };
}

export async function listProjectQuotes(db: Db, projectId: string, options: { issuedOnly?: boolean } = {}) {
  const where = options.issuedOnly
    ? and(eq(quotes.projectId, projectId), inArray(quotes.status, ["sent", "accepted", "expired", "superseded", "declined"]))
    : eq(quotes.projectId, projectId);
  return db.select().from(quotes).where(where).orderBy(quotes.version);
}

