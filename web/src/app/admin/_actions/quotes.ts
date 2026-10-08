"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/next-session";
import { DomainError } from "@/lib/errors";
import { generateDocumentPdf } from "@/lib/services/documents";
import { getProject, transitionProject } from "@/lib/services/projects";
import {
  createQuoteDraft,
  getQuoteWithLines,
  sendQuote,
  updateQuoteDraft,
  type QuoteDraftInput,
} from "@/lib/services/quotes";
import type { ActionState } from "@/lib/ui/action-state";
import { runAction } from "@/lib/ui/errors";
import { str } from "@/lib/ui/form";

const projectPath = (projectId: string) => `/admin/projects/${projectId}`;

/** Before any quote: drafting the first initial quote moves the project to "quote_draft". */
const PRE_QUOTE = new Set(["lead", "qualified", "discovery"]);

export async function saveQuoteDraftAction(
  projectId: string,
  quoteId: string | null,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const result = await runAction(async () => {
    const db = getDb();
    const raw: unknown = JSON.parse(str(fd, "payload") || "{}");
    if (typeof raw !== "object" || raw === null) throw new DomainError("invalid_input", "Invalid payload");
    // The project always comes from the URL, never from the submitted payload.
    const input = { ...(raw as Record<string, unknown>), projectId } as QuoteDraftInput;

    if (quoteId) {
      const { quote } = await getQuoteWithLines(db, quoteId);
      if (quote.projectId !== projectId) throw new DomainError("not_found", "Quote not in project");
      await updateQuoteDraft(db, quoteId, input);
    } else {
      await createQuoteDraft(db, input);
      const project = await getProject(db, projectId);
      if ((input.kind ?? "initial") === "initial" && PRE_QUOTE.has(project.status)) {
        await transitionProject(db, { projectId, to: "quote_draft", actor: "admin" });
      }
    }
  });
  if (result.status === "error") return result;
  revalidatePath(projectPath(projectId));
  redirect(`${projectPath(projectId)}#quotes`);
}

export async function sendQuoteAction(projectId: string, quoteId: string): Promise<ActionState> {
  await requireAdmin();
  return runAction(async () => {
    const db = getDb();
    const { quote } = await getQuoteWithLines(db, quoteId);
    if (quote.projectId !== projectId) throw new DomainError("not_found", "Quote not in project");
    const { quote: sent, document } = await sendQuote(db, { quoteId });
    let warning = "";
    try {
      await generateDocumentPdf(db, document.id);
    } catch (err) {
      console.error("[pdf] generation failed", err);
      warning = " تعذّر توليد PDF الآن (تحقق من CHROMIUM_PATH)؛ سيُعاد المحاولة عند فتحه.";
    }
    revalidatePath(projectPath(projectId));
    return { status: "ok", message: `صدر عرض السعر ${sent.ref} ويظهر للعميل في صفحة التتبع.${warning}` };
  });
}
