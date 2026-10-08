import { describe, expect, it } from "vitest";
import type { QuoteSnapshot, ReceiptSnapshot } from "@/lib/documents/snapshots";
import { escapeHtml, NOT_TAX_INVOICE_AR, renderQuoteHtml, renderReceiptHtml } from "@/lib/pdf/templates";

const issuer = { name: "الاستوديو", country: "تركيا", email: "hello@example.com", domain: "example.com", whatsapp: "" };
const client = {
  name: '<script>alert("x")</script>',
  companyName: null,
  country: "SA",
  email: "client@example.com",
  phone: null,
  taxId: null,
};

const receipt: ReceiptSnapshot = {
  type: "receipt",
  ref: "R-2026-0001",
  issuedAt: "2026-10-08T10:00:00.000Z",
  documentMode: "receipt",
  currency: "USD",
  issuer,
  client,
  project: { ref: "P-2026-0001", title: "أتمتة الفواتير" },
  quoteRef: "Q-2026-0001",
  milestone: { kind: "deposit", sequence: 1, label: "الدفعة المقدمة" },
  amountMinor: 40_000,
  paidAt: "2026-10-08T09:00:00.000Z",
  paymentMethod: "payoneer",
  providerRef: "PO-123",
  contractTotalMinor: 80_000,
  paidToDateMinor: 40_000,
  remainingMinor: 40_000,
};

const quote: QuoteSnapshot = {
  type: "quote_pdf",
  ref: "Q-2026-0001",
  version: 1,
  issuedAt: "2026-10-08T10:00:00.000Z",
  validUntil: "2026-10-15",
  currency: "EUR",
  issuer,
  client: { ...client, name: "شركة النور" },
  project: { ref: "P-2026-0001", title: "بوت واتساب" },
  title: "موظف استقبال واتساب ذكي",
  summary: "رد آلي على الاستفسارات",
  scopeIncluded: ["إعداد البوت"],
  scopeExcluded: ["رسوم ميتا"],
  assumptions: [],
  acceptanceCriteria: [],
  timeline: "10 أيام عمل",
  revisionsIncluded: 2,
  warrantyDays: 30,
  thirdPartyCosts: null,
  lines: [{ description: "إعداد وتدريب", quantity: 1, unitPriceMinor: 80_000, totalMinor: 80_000 }],
  subtotalMinor: 80_000,
  discountMinor: 0,
  totalMinor: 80_000,
  paymentPlan: [
    { kind: "deposit", sequence: 1, percent: 50, amountMinor: 40_000 },
    { kind: "balance", sequence: 2, percent: 50, amountMinor: 40_000 },
  ],
  termsVersion: "draft-2026-10",
};

describe("document templates", () => {
  it("renders the receipt RTL with the visible not-a-tax-invoice line", () => {
    const html = renderReceiptHtml(receipt);
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain("إيصال دفع");
    expect(html).toContain(NOT_TAX_INVOICE_AR);
    expect(html).toContain('<bdi dir="ltr">R-2026-0001</bdi>');
    expect(html).toContain("400.00");
    expect(html).toContain("@font-face");
  });

  it("escapes user content", () => {
    const html = renderReceiptHtml(receipt);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(escapeHtml(`a&b"'<>`)).toBe("a&amp;b&quot;&#39;&lt;&gt;");
  });

  it("renders quote sections: scope, exclusions, prices, payment schedule", () => {
    const html = renderQuoteHtml(quote);
    expect(html).toContain("عرض سعر");
    expect(html).toContain("Q-2026-0001");
    expect(html).toContain("النطاق: لا يشمل");
    expect(html).toContain("رسوم ميتا");
    expect(html).toContain("جدول الدفع");
    expect(html).toContain("800.00");
    expect(html).not.toContain(NOT_TAX_INVOICE_AR);
  });
});
