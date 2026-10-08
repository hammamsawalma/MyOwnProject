import { getDb } from "@/db/client";
import { NotFoundError } from "@/lib/errors";
import { verifyPortalToken } from "@/lib/portal-access";
import { getDocument, getDocumentPdf } from "@/lib/services/documents";
import { deniedResponse, fileResponse } from "@/lib/ui/http";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_DOCUMENT_TYPES = new Set(["quote_pdf", "receipt", "credit_note"]);

/** Quote / receipt / credit note PDF of this link's project only. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const access = await verifyPortalToken(token);
  if (!access.ok || !UUID.test(id)) return deniedResponse();

  const db = getDb();
  try {
    const doc = await getDocument(db, id);
    if (doc.projectId !== access.projectId || !CLIENT_DOCUMENT_TYPES.has(doc.type)) return deniedResponse();
    const { ref, pdf } = await getDocumentPdf(db, id);
    return fileResponse(pdf, { fileName: `${ref}.pdf`, contentType: "application/pdf" });
  } catch (err) {
    if (err instanceof NotFoundError) return deniedResponse();
    throw err;
  }
}
