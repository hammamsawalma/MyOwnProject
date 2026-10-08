import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { settings } from "@/db/schema";
import { DOCUMENT_MODES, type DocumentMode } from "./domain-enums";
import { resolvePaymentPolicy, PaymentPolicySchema, type PaymentPolicy } from "./payment-plan";

/** Runtime-editable settings stored as JSON in the `settings` table. */

export async function getSetting(db: Db, key: string): Promise<unknown> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key));
  return row?.value;
}

export async function setSetting(db: Db, key: string, value: unknown): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

export async function getDocumentMode(db: Db): Promise<DocumentMode> {
  const value = await getSetting(db, "document_mode");
  return (DOCUMENT_MODES as readonly unknown[]).includes(value) ? (value as DocumentMode) : "receipt";
}

export async function setDocumentMode(db: Db, mode: DocumentMode): Promise<void> {
  if (!(DOCUMENT_MODES as readonly string[]).includes(mode)) throw new Error(`Invalid document mode: ${mode}`);
  await setSetting(db, "document_mode", mode);
}

export async function getPaymentPolicy(db: Db): Promise<PaymentPolicy> {
  return resolvePaymentPolicy(await getSetting(db, "payment_policy"));
}

export async function setPaymentPolicyOverride(db: Db, override: Partial<PaymentPolicy>): Promise<PaymentPolicy> {
  const partial = PaymentPolicySchema.partial().parse(override);
  const resolved = resolvePaymentPolicy(partial);
  await setSetting(db, "payment_policy", partial);
  return resolved;
}
