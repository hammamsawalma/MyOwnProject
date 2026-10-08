import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { paymentMilestones } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/next-session";
import { getObject, storageKeyFileName } from "@/lib/storage";
import { fileResponse } from "@/lib/ui/http";
import { assertUuid } from "@/lib/ui/not-found";

/** Proof-of-payment file attached to a milestone (admin only). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  assertUuid(id);
  const [milestone] = await getDb().select().from(paymentMilestones).where(eq(paymentMilestones.id, id));
  if (!milestone?.evidenceKey) notFound();
  const fileName = storageKeyFileName(milestone.evidenceKey).replace(/^[0-9a-f-]{36}-/, "");
  return fileResponse(await getObject(milestone.evidenceKey), { fileName });
}
