import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/next-session";
import { getDocumentPdf } from "@/lib/services/documents";
import { fileResponse } from "@/lib/ui/http";
import { assertUuid, orNotFound } from "@/lib/ui/not-found";

/** PDF of an issued document (generated on first request if missing). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  assertUuid(id);
  const { ref, pdf } = await orNotFound(getDocumentPdf(getDb(), id));
  return fileResponse(pdf, { fileName: `${ref}.pdf`, contentType: "application/pdf" });
}
