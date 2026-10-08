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
import { AR_NOUNS, arCount } from "@/lib/plural";
import { embeddedFontCss, PDF_FONT_FAMILY } from "./fonts";

/**
 * Arabic (RTL) document templates: quote (report 09 §4.11), payment receipt and
 * credit note (§4.12). Latin fragments (refs, amounts, emails) are wrapped in
 * <bdi dir="ltr"> so the bidi algorithm never reorders them, and free text typed
 * by people (names, titles, scope, descriptions) in <bdi> (direction detected
 * from its first letter), so "Acme Ltd." keeps its trailing dot.
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
const ltr = (value: string) => `<bdi dir="ltr" class="nw">${e(value)}</bdi>`;
const text = (value: string) => `<bdi>${e(value)}</bdi>`;
const money = (minor: number, currency: Currency) => ltr(formatMoney(minor, currency, "ar"));

/** "SA" -> "السعودية"; values that are not ISO codes (e.g. the issuer's "تركيا") pass through. */
function countryLabel(value: string): string {
  if (!/^[A-Z]{2}$/.test(value)) return value;
  try {
    return new Intl.DisplayNames(["ar"], { type: "region" }).of(value) ?? value;
  } catch {
    return value;
  }
}

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
.meta .label { color: ${brand.colors.muted}; width: 16%; white-space: nowrap; }
.nw { white-space: nowrap; }
.next { border: 1px solid ${brand.colors.border}; border-radius: 6px; padding: 8px 10px; background: #F8FAFC; }
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
    `<strong>${text(party.companyName ?? party.name)}</strong>`,
    party.companyName ? text(party.name) : null,
    party.country ? e(countryLabel(party.country)) : null,
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

function list(items: string[], ordered = false): string {
  if (!items.length) return `<p class="note">—</p>`;
  const tag = ordered ? "ol" : "ul";
  return `<${tag}>${items.map((i) => `<li>${text(i)}</li>`).join("")}</${tag}>`;
}

function footer(s: DocumentSnapshot): string {
  return `<footer><span>${e(s.issuer.name)} · ${ltr(s.issuer.domain)}</span><span>${ltr(s.ref)}</span></footer>`;
}

function warrantyText(days: number): string {
  return days > 0 ? arCount(days, AR_NOUNS.day) : "بلا ضمان";
}

/**
 * The acceptance instructions only when the client could accept online at issue
 * time; while sales are off (SALES_ENABLED=false) a neutral review-only line.
 */
function nextStep(s: QuoteSnapshot): string {
  if (s.acceptanceOpen !== true) {
    return "هذا العرض للاطلاع والمراجعة. سيُفتح قبول العرض والدفع قريبًا وسنتواصل معك حينها؛ لا يُطلب منك دفع أي مبلغ الآن.";
  }
  const deadline = s.validUntil ? `قبل ${e(formatDate(s.validUntil))} ` : "";
  return `يُقبَل العرض من صفحة متابعة المشروع (الرابط الخاص المرسل إليك) ${deadline}بالموافقة على الشروط (نسخة ${ltr(s.termsVersion)}) وتأكيد طلب البدء فورًا والتنازل عن حق العدول، ثم إدخال رمز التحقق الذي يصل إلى بريدك.`;
}

export function renderQuoteHtml(s: QuoteSnapshot): string {
  const rows = s.lines
    .map(
      (l, i) => `<tr><td>${i + 1}</td><td>${text(l.description)}</td><td class="num">${ltr(String(l.quantity))}</td>
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
      <td class="label">التاريخ</td><td class="nw">${e(formatDate(s.issuedAt))}</td></tr>
  <tr><td class="label">المشروع</td><td>${text(s.project.title)} <span class="note">${ltr(s.project.ref)}</span></td>
      <td class="label">صالح حتى</td><td class="nw">${s.validUntil ? e(formatDate(s.validUntil)) : "—"}</td></tr>
</table>
<div class="parties">${partyBlock("من", issuerParty(s))}${partyBlock("إلى", s.client)}</div>
<h2>${text(s.title)}</h2>
${s.summary ? `<p>${text(s.summary)}</p>` : ""}
<h2>النطاق: يشمل</h2>${list(s.scopeIncluded, true)}
<h2>النطاق: لا يشمل</h2>${list(s.scopeExcluded)}
${s.assumptions.length ? `<h2>الافتراضات والمطلوب من العميل</h2>${list(s.assumptions)}` : ""}
${s.acceptanceCriteria.length ? `<h2>معايير القبول</h2>${list(s.acceptanceCriteria)}` : ""}
${s.timeline ? `<h2>الجدول الزمني</h2><p>${text(s.timeline)}</p>` : ""}
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
<p>جولات المراجعة المشمولة: ${ltr(String(s.revisionsIncluded))} · مدة الضمان: ${e(warrantyText(s.warrantyDays))}</p>
${s.thirdPartyCosts ? `<h2>تكاليف الطرف الثالث</h2><p>${text(s.thirdPartyCosts)}</p>` : ""}
<h2>الخطوة التالية</h2>
<div class="next">
  <p style="margin:0">${nextStep(s)}</p>
  <p class="note" style="margin:4px 0 0">يبدأ العمل بعد استلام الدفعة المقدمة حسب جدول الدفع أعلاه.</p>
</div>
${footer(s)}`;
  return page(`عرض سعر ${s.ref}`, body);
}

export function renderReceiptHtml(s: ReceiptSnapshot): string {
  const body = `${header("إيصال دفع", "Payment Receipt", true)}
<table class="meta">
  <tr><td class="label">رقم الإيصال</td><td>${ltr(s.ref)}</td><td class="label">تاريخ الإصدار</td><td class="nw">${e(formatDate(s.issuedAt))}</td></tr>
  <tr><td class="label">المشروع</td><td>${text(s.project.title)} <span class="note">${ltr(s.project.ref)}</span></td>
      <td class="label">عرض السعر</td><td>${s.quoteRef ? ltr(s.quoteRef) : "—"}</td></tr>
  <tr><td class="label">العملة</td><td>${ltr(s.currency)}</td><td class="label">نوع المستند</td><td class="nw">إيصال دفع</td></tr>
</table>
<div class="parties">${partyBlock("المُصدِر", issuerParty(s))}${partyBlock("العميل", s.client)}</div>
<table class="items"><thead><tr><th>البيان</th><th class="num">المبلغ</th></tr></thead>
<tbody><tr><td>${text(s.milestone.label ?? MILESTONE_KIND_LABELS[s.milestone.kind].ar)} <span class="note">(الدفعة رقم ${ltr(String(s.milestone.sequence))}${s.quoteRef ? ` من عرض السعر ${ltr(s.quoteRef)}` : ""})</span></td><td class="num">${money(s.amountMinor, s.currency)}</td></tr></tbody></table>
<table class="totals">
  <tr class="grand"><td>المبلغ المستلم</td><td class="num">${money(s.amountMinor, s.currency)}</td></tr>
  <tr><td>قيمة الاتفاق</td><td class="num">${money(s.contractTotalMinor, s.currency)}</td></tr>
  <tr><td>المدفوع حتى الآن</td><td class="num">${money(s.paidToDateMinor, s.currency)}</td></tr>
  <tr><td>المتبقي</td><td class="num">${money(s.remainingMinor, s.currency)}</td></tr>
</table>
<table class="meta">
  <tr><td class="label">تاريخ الدفع</td><td class="nw">${e(formatDate(s.paidAt))}</td></tr>
  <tr><td class="label">وسيلة الدفع</td><td>${s.paymentMethod ? ltr(s.paymentMethod) : "—"}</td></tr>
  <tr><td class="label">مرجع المعاملة</td><td>${s.providerRef ? ltr(s.providerRef) : "—"}</td></tr>
  <tr><td class="label">الضرائب</td><td>${NOT_TAX_INVOICE_AR}</td></tr>
</table>
<h2>ملاحظات</h2>
<p>${
    s.remainingMinor > 0
      ? `المتبقي ${money(s.remainingMinor, s.currency)} يُسدَّد حسب جدول الدفع المتفق عليه، وتُسلَّم الملفات النهائية بعد سداد آخر دفعة.`
      : "تم سداد قيمة الاتفاق كاملة. شكرًا لثقتك."
  }</p>
<p class="note">هذا إيصال باستلام دفعة، وليس فاتورة ضريبية. المبالغ تشمل رسوم الدفع.</p>
${footer(s)}`;
  return page(`إيصال دفع ${s.ref}`, body);
}

export function renderCreditNoteHtml(s: CreditNoteSnapshot): string {
  const body = `${header("إشعار دائن", "Credit Note", true)}
<table class="meta">
  <tr><td class="label">رقم الإشعار</td><td>${ltr(s.ref)}</td><td class="label">تاريخ الإصدار</td><td>${e(formatDate(s.issuedAt))}</td></tr>
  <tr><td class="label">المشروع</td><td>${text(s.project.title)} <span class="note">${ltr(s.project.ref)}</span></td>
      <td class="label">يعكس المستند</td><td>${ltr(s.reversesRef)}</td></tr>
</table>
<div class="parties">${partyBlock("المُصدِر", issuerParty(s))}${partyBlock("العميل", s.client)}</div>
<table class="items"><thead><tr><th>السبب</th><th class="num">المبلغ المُعاد</th></tr></thead>
<tbody><tr><td>${text(s.reason)}</td><td class="num">${money(s.amountMinor, s.currency)}</td></tr></tbody></table>
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
