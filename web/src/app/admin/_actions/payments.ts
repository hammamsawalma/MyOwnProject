"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/next-session";
import { DomainError } from "@/lib/errors";
import { CURRENCIES } from "@/lib/money";
import { MILESTONE_KINDS } from "@/lib/payment-plan";
import { assertSalesEnabled } from "@/lib/sales";
import { generateDocumentPdf, issueCreditNote, listProjectDocuments } from "@/lib/services/documents";
import {
  createMilestone,
  deleteDraftMilestone,
  listMilestones,
  markMilestone,
  recordPayment,
  sendPaymentRequest,
  storePaymentEvidence,
} from "@/lib/services/payments";
import { addProjectEvent } from "@/lib/services/projects";
import type { ActionState } from "@/lib/ui/action-state";
import { runAction } from "@/lib/ui/errors";
import { parseDateInput } from "@/lib/ui/format";
import { file, money, oneOf, optStr, str } from "@/lib/ui/form";

const projectPath = (projectId: string) => `/admin/projects/${projectId}`;

async function assertMilestoneInProject(projectId: string, milestoneId: string) {
  const milestone = (await listMilestones(getDb(), projectId)).find((m) => m.id === milestoneId);
  if (!milestone) throw new DomainError("not_found", "Milestone not in project");
  return milestone;
}

/** Renders the PDF right after issuing; on failure the download route retries later. */
async function tryGeneratePdf(documentId: string): Promise<string | null> {
  try {
    await generateDocumentPdf(getDb(), documentId);
    return null;
  } catch (err) {
    console.error("[pdf] generation failed", err);
    return "تعذّر توليد ملف PDF الآن (تحقق من CHROMIUM_PATH)؛ سيُعاد المحاولة عند فتحه.";
  }
}

export async function createMilestoneAction(projectId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  return runAction(async () => {
    const currency = oneOf(fd, "currency", CURRENCIES);
    await createMilestone(getDb(), {
      projectId,
      kind: oneOf(fd, "kind", MILESTONE_KINDS),
      label: optStr(fd, "label"),
      amountMinor: money(fd, "amount", currency),
      currency,
    });
    revalidatePath(projectPath(projectId));
    return { status: "ok", message: "أُضيفت الدفعة كمسودة." };
  });
}

export async function deleteMilestoneAction(projectId: string, milestoneId: string): Promise<ActionState> {
  await requireAdmin();
  return runAction(async () => {
    await assertMilestoneInProject(projectId, milestoneId);
    await deleteDraftMilestone(getDb(), milestoneId);
    revalidatePath(projectPath(projectId));
  });
}

export async function sendPaymentRequestAction(
  projectId: string,
  milestoneId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  await requireAdmin();
  return runAction(async () => {
    await assertMilestoneInProject(projectId, milestoneId);
    await sendPaymentRequest(getDb(), {
      milestoneId,
      payUrl: str(fd, "payUrl"),
      provider: str(fd, "provider") || "payoneer",
    });
    revalidatePath(projectPath(projectId));
    return { status: "ok", message: "أُرسل طلب الدفع ويظهر الرابط للعميل." };
  });
}

export async function recordPaymentAction(
  projectId: string,
  milestoneId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  await requireAdmin();
  return runAction(async () => {
    // Checked before storing the evidence file, so nothing is kept for a refused payment.
    assertSalesEnabled("record_payment");
    await assertMilestoneInProject(projectId, milestoneId);
    const evidence = await file(fd, "evidence");
    const evidenceKey = evidence ? await storePaymentEvidence(projectId, evidence) : null;
    const paidOn = str(fd, "paidAt");
    const { receipt } = await recordPayment(getDb(), {
      milestoneId,
      paidAt: paidOn ? (parseDateInput(paidOn) ?? undefined) : undefined,
      provider: optStr(fd, "provider"),
      providerRef: optStr(fd, "providerRef"),
      evidenceNote: optStr(fd, "evidenceNote"),
      evidenceKey,
    });
    const warning = await tryGeneratePdf(receipt.id);
    revalidatePath(projectPath(projectId));
    return { status: "ok", message: `سُجّلت الدفعة وصدر الإيصال ${receipt.ref}.${warning ? ` ${warning}` : ""}` };
  });
}

export async function markMilestoneAction(
  projectId: string,
  milestoneId: string,
  status: "refunded" | "disputed",
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  await requireAdmin();
  return runAction(async () => {
    await assertMilestoneInProject(projectId, milestoneId);
    await markMilestone(getDb(), { milestoneId, status, note: optStr(fd, "note") });
    revalidatePath(projectPath(projectId));
    return {
      status: "ok",
      message:
        status === "refunded"
          ? "عُلّمت الدفعة مستردة. أصدر إشعارًا دائنًا من قسم المستندات."
          : "عُلّمت الدفعة معترضًا عليها.",
    };
  });
}

export async function issueCreditNoteAction(
  projectId: string,
  receiptId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  await requireAdmin();
  return runAction(async () => {
    const db = getDb();
    const receipt = (await listProjectDocuments(db, projectId)).find((d) => d.id === receiptId && d.type === "receipt");
    if (!receipt) throw new DomainError("not_found", "Receipt not in project");
    const reason = str(fd, "reason");
    if (!reason) throw new DomainError("invalid_input", "Reason is required");
    const amountRaw = str(fd, "amount");
    const note = await issueCreditNote(db, {
      receiptId,
      reason,
      amountMinor: amountRaw ? money(fd, "amount", receipt.currency) : undefined,
    });
    await addProjectEvent(db, {
      projectId,
      type: "credit_note_issued",
      actor: "admin",
      note: reason,
      payload: { documentId: note.id, ref: note.ref, reverses: receipt.ref },
    });
    const warning = await tryGeneratePdf(note.id);
    revalidatePath(projectPath(projectId));
    return { status: "ok", message: `صدر الإشعار الدائن ${note.ref}.${warning ? ` ${warning}` : ""}` };
  });
}
