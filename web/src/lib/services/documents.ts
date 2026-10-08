import { createHash } from "node:crypto";
import { and, eq, isNull, sum } from "drizzle-orm";
import { brand } from "@/config/brand";
import type { Db } from "@/db/client";
import { clients, documents, paymentMilestones, projects, quoteLineItems, quotes } from "@/db/schema";
import type {
  CreditNoteSnapshot,
  IssuerBlock,
  PartyBlock,
  QuoteSnapshot,
  ReceiptSnapshot,
} from "@/lib/documents/snapshots";
import { DomainError, NotFoundError } from "@/lib/errors";
import { allocateNumber, NUMBER_SERIES, parseDocumentNumber } from "@/lib/numbering";
import { htmlToPdf } from "@/lib/pdf/render";
import { renderDocumentHtml } from "@/lib/pdf/templates";
import { getDocumentMode } from "@/lib/settings";
import { getObject, makeStorageKey, objectExists, putObject } from "@/lib/storage";

export type DocumentRow = typeof documents.$inferSelect;
type QuoteRow = typeof quotes.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type ClientRow = typeof clients.$inferSelect;
type MilestoneRow = typeof paymentMilestones.$inferSelect;

export function issuerBlock(): IssuerBlock {
  return {
    name: brand.issuer.name.ar,
    country: brand.issuer.country.ar,
    email: brand.contact.email,
    domain: brand.domain,
    whatsapp: brand.contact.whatsappE164,
  };
}

export function partyFromClient(client: ClientRow): PartyBlock {
  return {
    name: client.name,
    companyName: client.companyName,
    country: client.country,
    email: client.email,
    phone: client.phoneE164,
    taxId: client.taxId,
  };
}

/** Inserts the immutable quote_pdf document for a quote being sent (same transaction). */
export async function issueQuoteDocumentInTx(
  tx: Db,
  input: { quote: QuoteRow; project: ProjectRow; client: ClientRow; now: Date },
): Promise<DocumentRow> {
  const { quote, project, client, now } = input;
  if (!quote.ref || !quote.termsVersion) throw new Error("quote must have a ref and terms version before issuing");
  const lines = await tx
    .select()
    .from(quoteLineItems)
    .where(eq(quoteLineItems.quoteId, quote.id))
    .orderBy(quoteLineItems.position);

  const snapshot: QuoteSnapshot = {
    type: "quote_pdf",
    ref: quote.ref,
    version: quote.version,
    issuedAt: now.toISOString(),
    validUntil: quote.validUntil,
    currency: quote.currency,
    issuer: issuerBlock(),
    client: partyFromClient(client),
    project: { ref: project.ref, title: project.title },
    title: quote.title,
    summary: quote.summary,
    scopeIncluded: quote.scopeIncluded,
    scopeExcluded: quote.scopeExcluded,
    assumptions: quote.assumptions,
    acceptanceCriteria: quote.acceptanceCriteria,
    timeline: quote.timeline,
    revisionsIncluded: quote.revisionsIncluded,
    warrantyDays: quote.warrantyDays,
    thirdPartyCosts: quote.thirdPartyCosts,
    lines: lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      totalMinor: l.totalMinor,
    })),
    subtotalMinor: quote.subtotalMinor,
    discountMinor: quote.discountMinor,
    totalMinor: quote.totalMinor,
    paymentPlan: quote.paymentPlan,
    termsVersion: quote.termsVersion,
  };

  return insertDocument(tx, {
    ref: quote.ref,
    type: "quote_pdf",
    projectId: project.id,
    clientId: client.id,
    quoteId: quote.id,
    currency: quote.currency,
    amountMinor: quote.totalMinor,
    documentMode: await getDocumentMode(tx),
    snapshot,
    issuedAt: now,
  });
}

/**
 * Issues the R-YYYY-NNNN payment receipt for a milestone just marked paid. Must
 * run in the same transaction as the payment update so numbering stays gapless.
 */
export async function issueReceiptInTx(tx: Db, input: { milestone: MilestoneRow; now: Date }): Promise<DocumentRow> {
  const { milestone, now } = input;
  const documentMode = await getDocumentMode(tx);
  if (documentMode !== "receipt") {
    throw new DomainError(
      "tax_invoice_provider_not_configured",
      "document_mode is tax_invoice_via_provider but no e-invoice provider is integrated yet",
    );
  }
  const [project] = await tx.select().from(projects).where(eq(projects.id, milestone.projectId));
  if (!project) throw new NotFoundError("project", milestone.projectId);
  const [client] = await tx.select().from(clients).where(eq(clients.id, project.clientId));
  if (!client) throw new NotFoundError("client", project.clientId);
  const quote = milestone.quoteId
    ? (await tx.select().from(quotes).where(eq(quotes.id, milestone.quoteId)))[0]
    : undefined;

  const all = await tx.select().from(paymentMilestones).where(eq(paymentMilestones.projectId, project.id));
  const contractTotalMinor = all.reduce((acc, m) => acc + m.amountMinor, 0);
  const paidToDateMinor = all.filter((m) => m.status === "paid").reduce((acc, m) => acc + m.amountMinor, 0);

  const { ref } = await allocateNumber(tx, NUMBER_SERIES.receipt, { date: now });
  const snapshot: ReceiptSnapshot = {
    type: "receipt",
    ref,
    issuedAt: now.toISOString(),
    documentMode,
    currency: milestone.currency,
    issuer: issuerBlock(),
    client: partyFromClient(client),
    project: { ref: project.ref, title: project.title },
    quoteRef: quote?.ref ?? null,
    milestone: { kind: milestone.kind, sequence: milestone.sequence, label: milestone.label },
    amountMinor: milestone.amountMinor,
    paidAt: (milestone.paidAt ?? now).toISOString(),
    paymentMethod: milestone.provider,
    providerRef: milestone.providerRef,
    contractTotalMinor,
    paidToDateMinor,
    remainingMinor: contractTotalMinor - paidToDateMinor,
  };

  return insertDocument(tx, {
    ref,
    type: "receipt",
    projectId: project.id,
    clientId: client.id,
    quoteId: milestone.quoteId,
    milestoneId: milestone.id,
    currency: milestone.currency,
    amountMinor: milestone.amountMinor,
    documentMode,
    snapshot,
    issuedAt: now,
  });
}

/** Reverses (part of) a receipt with a CN-YYYY-NNNN credit note. */
export async function issueCreditNote(
  db: Db,
  input: { receiptId: string; reason: string; amountMinor?: number; now?: Date },
): Promise<DocumentRow> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [receipt] = await tx.select().from(documents).where(eq(documents.id, input.receiptId)).for("update");
    if (!receipt) throw new NotFoundError("document", input.receiptId);
    if (receipt.type !== "receipt") throw new DomainError("invalid_input", "Only receipts can be reversed");

    const [credited] = await tx
      .select({ total: sum(documents.amountMinor).mapWith(Number) })
      .from(documents)
      .where(and(eq(documents.reversesDocumentId, receipt.id), eq(documents.type, "credit_note")));
    const remaining = receipt.amountMinor - (credited?.total ?? 0);
    const amountMinor = input.amountMinor ?? remaining;
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > remaining) {
      throw new DomainError("invalid_amount", `Credit note amount must be between 1 and ${remaining}`);
    }

    const [project] = await tx.select().from(projects).where(eq(projects.id, receipt.projectId));
    const [client] = await tx.select().from(clients).where(eq(clients.id, receipt.clientId));
    if (!project || !client) throw new NotFoundError("project", receipt.projectId);

    const documentMode = await getDocumentMode(tx);
    const { ref } = await allocateNumber(tx, NUMBER_SERIES.creditNote, { date: now });
    const snapshot: CreditNoteSnapshot = {
      type: "credit_note",
      ref,
      issuedAt: now.toISOString(),
      documentMode,
      currency: receipt.currency,
      issuer: issuerBlock(),
      client: partyFromClient(client),
      project: { ref: project.ref, title: project.title },
      reversesRef: receipt.ref,
      amountMinor,
      reason: input.reason,
    };
    return insertDocument(tx, {
      ref,
      type: "credit_note",
      projectId: project.id,
      clientId: client.id,
      quoteId: receipt.quoteId,
      milestoneId: receipt.milestoneId,
      reversesDocumentId: receipt.id,
      currency: receipt.currency,
      amountMinor,
      documentMode,
      snapshot,
      issuedAt: now,
    });
  });
}

async function insertDocument(tx: Db, values: typeof documents.$inferInsert): Promise<DocumentRow> {
  const [row] = await tx.insert(documents).values(values).returning();
  if (!row) throw new Error("document insert failed");
  return row;
}

export async function getDocument(db: Db, documentId: string): Promise<DocumentRow> {
  const [row] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!row) throw new NotFoundError("document", documentId);
  return row;
}

/**
 * Renders the document's PDF from its snapshot and attaches it (once). Runs
 * after the issuing transaction commits, so Chromium never holds a counter lock.
 * Idempotent: returns the existing PDF key when already rendered.
 */
export async function generateDocumentPdf(
  db: Db,
  documentId: string,
  options: { render?: (html: string) => Promise<Uint8Array> } = {},
): Promise<{ key: string; sha256: string }> {
  const doc = await getDocument(db, documentId);
  if (doc.pdfKey && doc.pdfSha256) return { key: doc.pdfKey, sha256: doc.pdfSha256 };

  const year = String(parseDocumentNumber(doc.ref)?.year ?? doc.issuedAt.getUTCFullYear());
  const key = makeStorageKey("documents", year, `${doc.ref}_${doc.id}.pdf`);
  let sha256: string;
  if (await objectExists(key)) {
    // A previous attempt stored the file but did not record it.
    sha256 = createHash("sha256").update(await getObject(key)).digest("hex");
  } else {
    const html = renderDocumentHtml(doc.snapshot);
    const pdf = await (options.render ?? htmlToPdf)(html);
    sha256 = (await putObject(key, pdf)).sha256;
  }

  await db
    .update(documents)
    .set({ pdfKey: key, pdfSha256: sha256 })
    .where(and(eq(documents.id, doc.id), isNull(documents.pdfKey)));
  return { key, sha256 };
}

export async function getDocumentPdf(db: Db, documentId: string): Promise<{ ref: string; pdf: Buffer }> {
  const { key } = await generateDocumentPdf(db, documentId);
  const doc = await getDocument(db, documentId);
  return { ref: doc.ref, pdf: await getObject(key) };
}

export async function listProjectDocuments(db: Db, projectId: string) {
  return db.select().from(documents).where(eq(documents.projectId, projectId)).orderBy(documents.issuedAt);
}
