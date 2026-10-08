import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { deliverables } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/next-session";
import { getObject, storageKeyFileName } from "@/lib/storage";
import { fileResponse } from "@/lib/ui/http";
import { assertUuid } from "@/lib/ui/not-found";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  assertUuid(id);
  const [row] = await getDb().select().from(deliverables).where(eq(deliverables.id, id));
  if (!row) notFound();
  if (!row.fileKey) {
    if (row.externalUrl) redirect(row.externalUrl);
    notFound();
  }
  const data = await getObject(row.fileKey);
  return fileResponse(data, {
    fileName: row.fileName ?? storageKeyFileName(row.fileKey),
    contentType: row.mimeType,
    inline: false,
  });
}
