// Relative imports: this file is also loaded by drizzle-kit via db/schema.ts.
import type { DocumentMode } from "../domain-enums";
import type { Currency } from "../money";
import type { MilestoneKind } from "../payment-plan";

/**
 * Data frozen into documents.snapshot at issuance. PDFs are rendered only from
 * these snapshots, so a document always re-renders exactly as issued.
 */

export interface IssuerBlock {
  name: string;
  country: string;
  email: string;
  domain: string;
  whatsapp: string;
}

export interface PartyBlock {
  name: string;
  companyName: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  taxId: string | null;
}

export interface LineBlock {
  description: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
}

export interface QuoteSnapshot {
  type: "quote_pdf";
  ref: string;
  version: number;
  issuedAt: string;
  validUntil: string | null;
  currency: Currency;
  issuer: IssuerBlock;
  client: PartyBlock;
  project: { ref: string; title: string };
  title: string;
  summary: string | null;
  scopeIncluded: string[];
  scopeExcluded: string[];
  assumptions: string[];
  acceptanceCriteria: string[];
  timeline: string | null;
  revisionsIncluded: number;
  warrantyDays: number;
  thirdPartyCosts: string | null;
  lines: LineBlock[];
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  paymentPlan: { kind: MilestoneKind; sequence: number; percent: number; amountMinor: number }[];
  termsVersion: string;
  /**
   * Whether the client could accept online when the quote was issued
   * (SALES_ENABLED). Missing in older snapshots: rendered as not open.
   */
  acceptanceOpen?: boolean;
}

export interface ReceiptSnapshot {
  type: "receipt";
  ref: string;
  issuedAt: string;
  documentMode: DocumentMode;
  currency: Currency;
  issuer: IssuerBlock;
  client: PartyBlock;
  project: { ref: string; title: string };
  quoteRef: string | null;
  milestone: { kind: MilestoneKind; sequence: number; label: string | null };
  amountMinor: number;
  paidAt: string;
  paymentMethod: string | null;
  providerRef: string | null;
  contractTotalMinor: number;
  paidToDateMinor: number;
  remainingMinor: number;
}

export interface CreditNoteSnapshot {
  type: "credit_note";
  ref: string;
  issuedAt: string;
  documentMode: DocumentMode;
  currency: Currency;
  issuer: IssuerBlock;
  client: PartyBlock;
  project: { ref: string; title: string };
  reversesRef: string;
  amountMinor: number;
  reason: string;
}

export type DocumentSnapshot = QuoteSnapshot | ReceiptSnapshot | CreditNoteSnapshot;
