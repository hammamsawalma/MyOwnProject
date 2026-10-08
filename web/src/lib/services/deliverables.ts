import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deliverables, paymentMilestones } from "@/db/schema";
import type { DeliverableKind } from "@/lib/domain-enums";
import { DomainError, NotFoundError } from "@/lib/errors";
import { canReleaseFinalDeliverables } from "@/lib/payment-plan";
import { makeStorageKey, putObject } from "@/lib/storage";

export type DeliverableRow = typeof deliverables.$inferSelect;

const SAFE_FILE_NAME = /[^A-Za-z0-9._-]+/g;

export async function addDeliverable(
  db: Db,
  input: {
    projectId: string;
    kind: DeliverableKind;
    title: string;
    file?: { data: Uint8Array; fileName: string; mimeType: string };
    externalUrl?: string;
    now?: Date;
  },
): Promise<DeliverableRow> {
  if (!input.file && !input.externalUrl) throw new DomainError("invalid_input", "A file or an external URL is required");
  if (input.externalUrl && !/^https?:\/\//.test(input.externalUrl)) {
    throw new DomainError("invalid_input", "External URL must be http(s)");
  }

  let stored: { key: string; sha256: string; sizeBytes: number } | null = null;
  if (input.file) {
    const safeName = input.file.fileName.replace(SAFE_FILE_NAME, "_").slice(-100) || "file";
    const key = makeStorageKey("deliverables", input.projectId, `${randomUUID()}-${safeName}`);
    stored = await putObject(key, input.file.data);
  }

  const [row] = await db
    .insert(deliverables)
    .values({
      projectId: input.projectId,
      kind: input.kind,
      title: input.title,
      fileKey: stored?.key ?? null,
      externalUrl: input.externalUrl ?? null,
      fileName: input.file?.fileName ?? null,
      mimeType: input.file?.mimeType ?? null,
      sizeBytes: stored?.sizeBytes ?? null,
      sha256: stored?.sha256 ?? null,
      // Previews are visible as soon as they are added; finals wait for full payment.
      released: input.kind === "preview",
      releasedAt: input.kind === "preview" ? (input.now ?? new Date()) : null,
      createdAt: input.now ?? new Date(),
    })
    .returning();
  if (!row) throw new Error("deliverable insert failed");
  return row;
}

/** Whether final files may be released or downloaded now: every milestone is paid. */
export async function finalsPaidFor(db: Db, projectId: string): Promise<boolean> {
  const milestones = await db
    .select({ status: paymentMilestones.status })
    .from(paymentMilestones)
    .where(eq(paymentMilestones.projectId, projectId));
  return canReleaseFinalDeliverables(milestones);
}

/** Releases final deliverables; refuses unless every payment milestone is paid. */
export async function releaseFinalDeliverablesInTx(db: Db, projectId: string, now: Date = new Date()): Promise<number> {
  if (!(await finalsPaidFor(db, projectId))) {
    throw new DomainError("milestones_unpaid", "Final deliverables are released only after the last payment");
  }
  const released = await db
    .update(deliverables)
    .set({ released: true, releasedAt: now })
    .where(and(eq(deliverables.projectId, projectId), eq(deliverables.kind, "final"), eq(deliverables.released, false)))
    .returning({ id: deliverables.id });
  return released.length;
}

export async function releaseFinalDeliverables(db: Db, projectId: string, now?: Date): Promise<number> {
  return db.transaction((tx) => releaseFinalDeliverablesInTx(tx, projectId, now));
}

/**
 * Checks that a deliverable may be downloaded. Finals must be released AND still
 * fully paid (a later refund or dispute locks them again). The caller must
 * already have verified the client's OTP (or a download grant) for finals.
 */
export async function getReleasedFinalDeliverable(db: Db, projectId: string, deliverableId: string) {
  const [row] = await db
    .select()
    .from(deliverables)
    .where(and(eq(deliverables.id, deliverableId), eq(deliverables.projectId, projectId)));
  if (!row) throw new NotFoundError("deliverable", deliverableId);
  if (!row.released) throw new DomainError("not_released", "This deliverable is not released yet");
  if (row.kind === "final" && !(await finalsPaidFor(db, projectId))) {
    throw new DomainError("milestones_unpaid", "Final deliverables are locked while a payment is refunded or disputed");
  }
  return row;
}

export async function listDeliverables(db: Db, projectId: string) {
  return db.select().from(deliverables).where(eq(deliverables.projectId, projectId)).orderBy(deliverables.createdAt);
}
