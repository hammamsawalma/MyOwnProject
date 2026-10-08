import { getDb } from "@/db/client";
import { DomainError } from "@/lib/errors";
import { hasDownloadGrant, verifyPortalToken } from "@/lib/portal-access";
import { getReleasedFinalDeliverable } from "@/lib/services/deliverables";
import { getObject, storageKeyFileName } from "@/lib/storage";
import { deniedResponse, externalRedirect, fileResponse } from "@/lib/ui/http";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deliverable download. Previews: valid link only. Finals: released, still fully
 * paid (no refund or dispute since) AND a fresh download grant from the email OTP.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const access = await verifyPortalToken(token);
  if (!access.ok || !UUID.test(id)) return deniedResponse();

  let row;
  try {
    row = await getReleasedFinalDeliverable(getDb(), access.projectId, id);
  } catch (err) {
    if (err instanceof DomainError) return deniedResponse();
    throw err;
  }
  if (row.kind === "final" && !(await hasDownloadGrant(access.projectId))) return deniedResponse(403);

  if (!row.fileKey) return row.externalUrl ? externalRedirect(row.externalUrl) : deniedResponse();
  return fileResponse(await getObject(row.fileKey), {
    fileName: row.fileName ?? storageKeyFileName(row.fileKey),
    contentType: row.mimeType,
    inline: false,
  });
}
