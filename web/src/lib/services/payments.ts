import { randomUUID } from "node:crypto";
import { eq, inArray, max } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { paymentMilestones, quotes } from "@/db/schema";
import type { EventActor } from "@/lib/domain-enums";
import { DomainError, NotFoundError } from "@/lib/errors";
import { CURRENCIES } from "@/lib/money";
import { canReleaseFinalDeliverables, MILESTONE_KINDS, MILESTONE_KIND_LABELS } from "@/lib/payment-plan";
import { assertSalesEnabled, getSalesConfig, type SalesConfig } from "@/lib/sales";
import { makeStorageKey, putObject } from "@/lib/storage";
import { issueReceiptInTx, type DocumentRow } from "./documents";
import { addProjectEvent, getProject, transitionProject } from "./projects";

export type MilestoneRow = typeof paymentMilestones.$inferSelect;

export const CreateMilestoneInput = z.object({
  projectId: z.uuid(),
  quoteId: z.uuid().nullish(),
  kind: z.enum(MILESTONE_KINDS),
  label: z.string().nullish(),
  amountMinor: z.number().int().positive(),
  currency: z.enum(CURRENCIES),
});

/**
 * Drafting milestones is always allowed, even while sales are disabled. They use
 * the project currency so totals and receipts never mix currencies.
 */
export async function createMilestone(db: Db, input: z.input<typeof CreateMilestoneInput>): Promise<MilestoneRow> {
  const data = CreateMilestoneInput.parse(input);
  return db.transaction(async (tx) => {
    const project = await getProject(tx, data.projectId, { forUpdate: true });
    if (data.currency !== project.currency) {
      throw new DomainError("currency_mismatch", `Milestones must use the project currency (${project.currency})`);
    }
    const [last] = await tx
      .select({ sequence: max(paymentMilestones.sequence) })
      .from(paymentMilestones)
      .where(eq(paymentMilestones.projectId, data.projectId));
    const [row] = await tx
      .insert(paymentMilestones)
      .values({
        ...data,
        quoteId: data.quoteId ?? null,
        label: data.label ?? MILESTONE_KIND_LABELS[data.kind].ar,
        sequence: (last?.sequence ?? 0) + 1,
        status: "draft",
      })
      .returning();
    if (!row) throw new Error("milestone insert failed");
    return row;
  });
}

/**
 * Deletes a manual draft milestone. Drafts created from an accepted quote are the
 * agreed schedule (the final-delivery rule depends on them) and are refused: the
 * schedule changes through a new quote version (before any payment) or an add-on.
 */
export async function deleteDraftMilestone(db: Db, milestoneId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const milestone = await lockMilestone(tx, milestoneId);
    if (milestone.status !== "draft") throw new DomainError("milestone_not_draft", "Only draft milestones can be deleted");
    if (milestone.quoteId) {
      const [quote] = await tx.select({ status: quotes.status }).from(quotes).where(eq(quotes.id, milestone.quoteId));
      if (quote?.status === "accepted") {
        throw new DomainError("milestone_agreed", "Milestones of an accepted quote cannot be deleted");
      }
    }
    await tx.delete(paymentMilestones).where(eq(paymentMilestones.id, milestone.id));
  });
}

async function lockMilestone(tx: Db, milestoneId: string): Promise<MilestoneRow> {
  const [row] = await tx.select().from(paymentMilestones).where(eq(paymentMilestones.id, milestoneId)).for("update");
  if (!row) throw new NotFoundError("payment milestone", milestoneId);
  return row;
}

/**
 * Attaches a payment link (e.g. a Payoneer payment request) and shows it to the
 * client. Blocked while SALES_ENABLED is false.
 */
export async function sendPaymentRequest(
  db: Db,
  input: { milestoneId: string; payUrl: string; provider: string; actor?: EventActor; now?: Date; sales?: SalesConfig },
): Promise<MilestoneRow> {
  assertSalesEnabled("send_payment_request", input.sales ?? getSalesConfig());
  if (!/^https:\/\//.test(input.payUrl)) throw new DomainError("invalid_input", "Payment URL must use https");
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const milestone = await lockMilestone(tx, input.milestoneId);
    if (!["draft", "sent"].includes(milestone.status)) {
      throw new DomainError("milestone_not_open", `Milestone is ${milestone.status}`);
    }
    const [row] = await tx
      .update(paymentMilestones)
      .set({ payUrl: input.payUrl, provider: input.provider, status: "sent", sentAt: now, updatedAt: now })
      .where(eq(paymentMilestones.id, milestone.id))
      .returning();
    if (!row) throw new Error("milestone update failed");
    await addProjectEvent(tx, {
      projectId: milestone.projectId,
      type: "payment_requested",
      actor: input.actor ?? "admin",
      visibleToClient: true,
      payload: { milestoneId: milestone.id, kind: milestone.kind, amountMinor: milestone.amountMinor, currency: milestone.currency },
      now,
    });
    return row;
  });
}

/**
 * Records a payment received outside the app (manual confirmation with optional
 * evidence), issues the R-YYYY-NNNN receipt in the same transaction, and
 * advances the project: deposit paid -> kickoff; last payment -> delivered.
 * Blocked while SALES_ENABLED is false.
 */
export async function recordPayment(
  db: Db,
  input: {
    milestoneId: string;
    paidAt?: Date;
    provider?: string | null;
    providerRef?: string | null;
    evidenceKey?: string | null;
    evidenceNote?: string | null;
    actor?: EventActor;
    now?: Date;
    sales?: SalesConfig;
  },
): Promise<{ milestone: MilestoneRow; receipt: DocumentRow }> {
  const sales = input.sales ?? getSalesConfig();
  assertSalesEnabled("record_payment", sales);
  assertSalesEnabled("issue_receipt", sales);
  const now = input.now ?? new Date();
  const actor = input.actor ?? "admin";

  return db.transaction(async (tx) => {
    const current = await lockMilestone(tx, input.milestoneId);
    if (!["draft", "sent"].includes(current.status)) {
      throw new DomainError("milestone_not_open", `Milestone is ${current.status}`);
    }
    const project = await getProject(tx, current.projectId, { forUpdate: true });

    const [milestone] = await tx
      .update(paymentMilestones)
      .set({
        status: "paid",
        paidAt: input.paidAt ?? now,
        provider: input.provider ?? current.provider,
        providerRef: input.providerRef ?? current.providerRef,
        evidenceKey: input.evidenceKey ?? current.evidenceKey,
        evidenceNote: input.evidenceNote ?? current.evidenceNote,
        updatedAt: now,
      })
      .where(eq(paymentMilestones.id, current.id))
      .returning();
    if (!milestone) throw new Error("milestone update failed");

    const receipt = await issueReceiptInTx(tx, { milestone, now });
    await addProjectEvent(tx, {
      projectId: project.id,
      type: "payment_recorded",
      actor,
      visibleToClient: true,
      payload: {
        milestoneId: milestone.id,
        kind: milestone.kind,
        amountMinor: milestone.amountMinor,
        currency: milestone.currency,
        receiptId: receipt.id,
        receiptRef: receipt.ref,
      },
      now,
    });

    const all = await tx
      .select({ status: paymentMilestones.status })
      .from(paymentMilestones)
      .where(eq(paymentMilestones.projectId, project.id));
    if (milestone.kind === "deposit" && project.status === "awaiting_deposit") {
      await transitionProject(tx, { projectId: project.id, to: "kickoff", actor: "system", now });
    } else if (project.status === "awaiting_balance" && canReleaseFinalDeliverables(all)) {
      await transitionProject(tx, { projectId: project.id, to: "delivered", actor: "system", now });
    }
    return { milestone, receipt };
  });
}

const MARK_FROM: Record<"refunded" | "disputed" | "paid", readonly string[]> = {
  refunded: ["paid", "disputed"],
  disputed: ["paid"],
  // A dispute resolved in our favour (e.g. chargeback won): the payment stands.
  paid: ["disputed"],
};

const MARK_EVENT: Record<keyof typeof MARK_FROM, string> = {
  refunded: "payment_refunded",
  disputed: "payment_disputed",
  paid: "payment_dispute_resolved",
};

/**
 * Marks a paid milestone refunded or disputed (a credit note is issued
 * separately), or closes a dispute so the milestone counts as paid again.
 */
export async function markMilestone(
  db: Db,
  input: {
    milestoneId: string;
    status: keyof typeof MARK_FROM;
    note?: string | null;
    actor?: EventActor;
    now?: Date;
  },
): Promise<MilestoneRow> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const current = await lockMilestone(tx, input.milestoneId);
    const allowedFrom = MARK_FROM[input.status];
    if (!allowedFrom.includes(current.status)) {
      throw new DomainError("milestone_invalid_status", `Cannot mark a ${current.status} milestone as ${input.status}`);
    }
    const [row] = await tx
      .update(paymentMilestones)
      .set({ status: input.status, evidenceNote: input.note ?? current.evidenceNote, updatedAt: now })
      .where(eq(paymentMilestones.id, current.id))
      .returning();
    if (!row) throw new Error("milestone update failed");
    await addProjectEvent(tx, {
      projectId: current.projectId,
      type: MARK_EVENT[input.status],
      actor: input.actor ?? "admin",
      note: input.note ?? null,
      payload: { milestoneId: current.id },
      now,
    });
    return row;
  });
}

/** Stores a proof-of-payment file and returns its storage key (for recordPayment's evidenceKey). */
export async function storePaymentEvidence(
  projectId: string,
  file: { data: Uint8Array; fileName: string },
): Promise<string> {
  const safeName = file.fileName.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-100) || "evidence";
  const key = makeStorageKey("evidence", projectId, `${randomUUID()}-${safeName}`);
  await putObject(key, file.data);
  return key;
}

export async function listMilestones(db: Db, projectId: string): Promise<MilestoneRow[]> {
  return db
    .select()
    .from(paymentMilestones)
    .where(eq(paymentMilestones.projectId, projectId))
    .orderBy(paymentMilestones.sequence);
}

export async function listOpenMilestones(db: Db): Promise<MilestoneRow[]> {
  return db.select().from(paymentMilestones).where(inArray(paymentMilestones.status, ["draft", "sent"]));
}
