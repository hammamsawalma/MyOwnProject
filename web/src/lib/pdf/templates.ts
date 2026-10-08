import { brand } from "@/config/brand";
import { env } from "@/config/env";
import type {
  CreditNoteSnapshot,
  DocumentSnapshot,
  PartyBlock,
  QuoteSnapshot,
  ReceiptSnapshot,
} from "@/lib/documents/snapshots";
import { formatMoney, type Currency } from "@/lib/money";
import { MILESTONE_KIND_LABELS } from "@/lib/payment-plan";
import { embeddedFontCss, PDF_FONT_FAMILY } from "./fonts";

/**
 * Arabic (RTL) document templates: quote (report 09 §4.11), payment receipt and
 * credit note (§4.12). Latin fragments (refs, amounts, emails) are wrapped in
 * <bdi dir="ltr"> so the bidi algorithm never reorders them.
 */

export const NOT_TAX_INVOICE_AR = "ليست فاتورة ضريبية";
export const NOT_TAX_INVOICE_EN = "Not a tax invoice";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const e = escapeHtml;
const ltr = (value: string) => `<bdi dir="ltr">${e(value)}</bdi>`;
const money = (minor: number, currency: Currency) => ltr(formatMoney(minor, currency, "ar"));

function formatDate(iso: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return new Intl.DateTimeFormat("ar-u-nu-latn", {
    dateStyle: "long",
    timeZone: env().BUSINESS_TIMEZONE,
  }).format(date);
}

const STYLES = `
@page { size: A4; margin: 16mm 14mm; }
* { box-sizing: border-box; }
body { font-family: '${PDF_FONT_FAMILY}', sans-serif; color: ${brand.colors.foreground}; font-size: 11pt; line-height: 1.55; margin: 0; }
header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid ${brand.colors.primary}; padding-bottom: 10px; margin-bottom: 16px; }
.logo { font-size: 20pt; font-weight: 700; color: ${brand.colors.primary}; }
.tagline { color: ${brand.colors.muted}; font-size: 9pt; }
.doc-title { text-align: end; }
.doc-title h1 { margin: 0; font-size: 17pt; color: ${brand.colors.primary}; }
.doc-title .sub { color: ${brand.colors.muted}; font-size: 9pt; }
.badge { display: inline-block; margin-top: 4px; padding: 2px 10px; border: 1.5px solid #B91C1C; color: #B91C1C; border-radius: 4px; font-weight: 700; font-size: 10pt; }
.meta { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
.meta td { padding: 3px 0; vertical-align: top; }
.meta .label { color: ${brand.colors.muted}; width: 22%; }
.parties { display: flex; gap: 16px; margin-bottom: 14px; }
.party { flex: 1; border: 1px solid ${brand.colors.border}; border-radius: 6px; padding: 8px 10px; }
.party h3 { margin: 0 0 4px; font-size: 10pt; color: ${brand.colors.muted}; }
h2 { font-size: 12pt; color: ${brand.colors.primary}; margin: 16px 0 6px; break-after: avoid-page; }
tr, .party, .totals { break-inside: avoid; }
ul, ol { margin: 0; padding-inline-start: 20px; }
table.items { width: 100%; border-collapse: collapse; margin-top: 6px; }
table.items th { background: ${brand.colors.primary}; color: ${brand.colors.primaryForeground}; font-weight: 700; padding: 6px; text-align: start; }
table.items td { border-bottom: 1px solid ${brand.colors.border}; padding: 6px; }
table.items .num { text-align: end; white-space: nowrap; }
.totals { width: 45%; margin-inline-start: auto; margin-top: 8px; border-collapse: collapse; }
.totals td { padding: 4px 6px; }
.totals .grand td { font-weight: 700; border-top: 2px solid ${brand.colors.primary}; font-size: 12pt; }
.note { color: ${brand.colors.muted}; font-size: 9pt; }
footer { margin-top: 24px; border-top: 1px solid ${brand.colors.border}; padding-top: 8px; color: ${brand.colors.muted}; font-size: 9pt; display: flex; justify-content: space-between; }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><title>${e(title)}</title>
<style>${embeddedFontCss()}</style>
<style>${STYLES}</style></head>
<body>${body}</body></html>`;
}

function header(titleAr: string, titleEn: string, notTaxInvoice: boolean): string {
  return `<header>
  <div><div class="logo">${e(brand.logoText.ar)}</div><div class="tagline">${e(brand.tagline.ar)}</div></div>
  <div class="doc-title"><h1>${e(titleAr)}</h1><div class="sub">${e(titleEn)}</div>
  ${notTaxInvoice ? `<div class="badge">${NOT_TAX_INVOICE_AR} · <span dir="ltr">${NOT_TAX_INVOICE_EN}</span></div>` : ""}
  </div>
</header>`;
}

function partyBlock(title: string, party: PartyBlock): string {
  const lines = [
    `<strong>${e(party.companyName ?? party.name)}</strong>`,
    party.companyName ? e(party.name) : null,
    party.country ? e(party.country) : null,
    party.email ? ltr(party.email) : null,
    party.phone ? ltr(party.phone) : null,
    party.taxId ? `الرقم الضريبي: ${ltr(party.taxId)}` : null,
  ].filter(Boolean);
  return `<div class="party"><h3>${e(title)}</h3>${lines.join("<br>")}</div>`;
}

function issuerParty(s: DocumentSnapshot): PartyBlock {
  return {
    name: s.issuer.name,
    companyName: null,
    country: s.issuer.country,
    email: s.issuer.email,
    phone: s.issuer.whatsapp || null,
    taxId: null,
  };
}

function list(items: string[]): string {
  return items.length ? `<ul>${items.map((i) => `<li>${e(i)}</li>`).join("")}</ul>` : `<p class="note">—</p>`;
}

function footer(s: DocumentSnapshot): string {
  return `<footer><span>${e(s.issuer.name)} · ${ltr(s.issuer.domain)}</span><span>${ltr(s.ref)}</span></footer>`;
}

export function renderQuoteHtml(s: QuoteSnapshot): string {
  const rows = s.lines
    .map(
      (l, i) => `<tr><td>${i + 1}</td><td>${e(l.description)}</td><td class="num">${ltr(String(l.quantity))}</td>
      <td class="num">${money(l.unitPriceMinor, s.currency)}</td><td class="num">${money(l.totalMinor, s.currency)}</td></tr>`,
    )
    .join("");
  const plan = s.paymentPlan
    .map(
      (m) => `<tr><td>${e(MILESTONE_KIND_LABELS[m.kind].ar)}</td><td class="num">${ltr(`${m.percent}%`)}</td>
      <td class="num">${money(m.amountMinor, s.currency)}</td></tr>`,
    )
    .join("");

  const body = `${header("عرض سعر", "Quotation", false)}
<table class="meta">
  <tr><td class="label">رقم العرض</td><td>${ltr(s.ref)} <span class="note">(الإصدار ${ltr(String(s.version))})</span></td>
      <td class="label">التاريخ</td><td>${e(formatDate(s.issuedAt))}</td></tr>
  <tr><td class="label">المشروع</td><td>${e(s.project.title)} <span class="note">${ltr(s.project.ref)}</span></td>
      <td class="label">صالح حتى</td><td>${s.validUntil ? e(formatDate(s.validUntil)) : "—"}</td></tr>
</table>
<div class="parties">${partyBlock("من", issuerParty(s))}${partyBlock("إلى", s.client)}</div>
<h2>${e(s.title)}</h2>
${s.summary ? `<p>${e(s.summary)}</p>` : ""}
<h2>النطاق: يشمل</h2>${list(s.scopeIncluded)}
<h2>النطاق: لا يشمل</h2>${list(s.scopeExcluded)}
${s.assumptions.length ? `<h2>الافتراضات والمطلوب من العميل</h2>${list(s.assumptions)}` : ""}
${s.acceptanceCriteria.length ? `<h2>معايير القبول</h2>${list(s.acceptanceCriteria)}` : ""}
${s.timeline ? `<h2>الجدول الزمني</h2><p>${e(s.timeline)}</p>` : ""}
<h2>السعر</h2>
<table class="items"><thead><tr><th>#</th><th>البند</th><th class="num">الكمية</th><th class="num">سعر الوحدة</th><th class="num">المجموع</th></tr></thead>
<tbody>${rows}</tbody></table>
<table class="totals">
  <tr><td>المجموع الفرعي</td><td class="num">${money(s.subtotalMinor, s.currency)}</td></tr>
  ${s.discountMinor > 0 ? `<tr><td>الخصم</td><td class="num">${money(-s.discountMinor, s.currency)}</td></tr>` : ""}
  <tr class="grand"><td>الإجمالي (${ltr(s.currency)})</td><td class="num">${money(s.totalMinor, s.currency)}</td></tr>
</table>
<p class="note">الأسعار نهائية وتشمل رسوم الدفع.</p>
<h2>جدول الدفع</h2>
<table class="items"><thead><tr><th>الدفعة</th><th class="num">النسبة</th><th class="num">المبلغ</th></tr></thead><tbody>${plan}</tbody></table>
<p class="note">لا تُسلَّم الملفات النهائية قبل سداد آخر دفعة.</p>
<h2>المراجعات والضمان</h2>
<p>جولات المراجعة المشمولة: ${ltr(String(s.revisionsIncluded))} · مدة الضمان: ${ltr(String(s.warrantyDays))} يومًا</p>
${s.thirdPartyCosts ? `<h2>تكاليف الطرف الثالث</h2><p>${e(s.thirdPartyCosts)}</p>` : ""}
<p class="note">قبول هذا العرض يتم عبر صفحة المشروع، ويعني الموافقة على الشروط (الإصدار ${ltr(s.termsVersion)}).</p>
${footer(s)}`;
  return page(`عرض سعر ${s.ref}`, body);
}

export function renderReceiptHtml(s: ReceiptSnapshot): string {
  const body = `${header("إيصال دفع", "Payment Receipt", true)}
<table class="meta">
  <tr><td class="label">رقم الإيصال</td><td>${ltr(s.ref)}</td><td class="label">تاريخ الإصدار</td><td>${e(formatDate(s.issuedAt))}</td></tr>
  <tr><td class="label">المشروع</td><td>${e(s.project.title)} <span class="note">${ltr(s.project.ref)}</span></td>
      <td class="label">عرض السعر</td><td>${s.quoteRef ? ltr(s.quoteRef) : "—"}</td></tr>
</table>
<div class="parties">${partyBlock("المُصدِر", issuerParty(s))}${partyBlock("العميل", s.client)}</div>
<table class="items"><thead><tr><th>البيان</th><th class="num">المبلغ</th></tr></thead>
<tbody><tr><td>${e(s.milestone.label ?? MILESTONE_KIND_LABELS[s.milestone.kind].ar)}</td><td class="num">${money(s.amountMinor, s.currency)}</td></tr></tbody></table>
<table class="totals">
  <tr class="grand"><td>المبلغ المستلم</td><td class="num">${money(s.amountMinor, s.currency)}</td></tr>
  <tr><td>قيمة الاتفاق</td><td class="num">${money(s.contractTotalMinor, s.currency)}</td></tr>
  <tr><td>المدفوع حتى الآن</td><td class="num">${money(s.paidToDateMinor, s.currency)}</td></tr>
  <tr><td>المتبقي</td><td class="num">${money(s.remainingMinor, s.currency)}</td></tr>
</table>
<table class="meta">
  <tr><td class="label">تاريخ الدفع</td><td>${e(formatDate(s.paidAt))}</td></tr>
  <tr><td class="label">وسيلة الدفع</td><td>${s.paymentMethod ? ltr(s.paymentMethod) : "—"}</td></tr>
  <tr><td class="label">مرجع المعاملة</td><td>${s.providerRef ? ltr(s.providerRef) : "—"}</td></tr>
  <tr><td class="label">الضرائب</td><td>${NOT_TAX_INVOICE_AR}</td></tr>
</table>
<p class="note">هذا إيصال باستلام دفعة، وليس فاتورة ضريبية.</p>
${footer(s)}`;
  return page(`إيصال دفع ${s.ref}`, body);
}

export function renderCreditNoteHtml(s: CreditNoteSnapshot): string {
  const body = `${header("إشعار دائن", "Credit Note", true)}
<table class="meta">
  <tr><td class="label">رقم الإشعار</td><td>${ltr(s.ref)}</td><td class="label">تاريخ الإصدار</td><td>${e(formatDate(s.issuedAt))}</td></tr>
  <tr><td class="label">المشروع</td><td>${e(s.project.title)} <span class="note">${ltr(s.project.ref)}</span></td>
      <td class="label">يعكس المستند</td><td>${ltr(s.reversesRef)}</td></tr>
</table>
<div class="parties">${partyBlock("المُصدِر", issuerParty(s))}${partyBlock("العميل", s.client)}</div>
<table class="items"><thead><tr><th>السبب</th><th class="num">المبلغ المُعاد</th></tr></thead>
<tbody><tr><td>${e(s.reason)}</td><td class="num">${money(s.amountMinor, s.currency)}</td></tr></tbody></table>
${footer(s)}`;
  return page(`إشعار دائن ${s.ref}`, body);
}

export function renderDocumentHtml(snapshot: DocumentSnapshot): string {
  switch (snapshot.type) {
    case "quote_pdf":
      return renderQuoteHtml(snapshot);
    case "receipt":
      return renderReceiptHtml(snapshot);
    case "credit_note":
      return renderCreditNoteHtml(snapshot);
  }
}
