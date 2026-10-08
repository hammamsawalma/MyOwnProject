import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { EmailNotConfiguredError } from "@/lib/email/send";
import { DomainError } from "@/lib/errors";
import { MoneyError } from "@/lib/money";
import { PaymentPlanError } from "@/lib/payment-plan";
import { GUARD_MESSAGES_AR, TransitionError } from "@/lib/project-status";
import { SalesDisabledError } from "@/lib/sales";
import type { Locale, Localized } from "@/lib/types";
import type { ActionState } from "./action-state";

/** Maps domain errors to short user-facing messages (Arabic; English for the client page). */

const DOMAIN_MESSAGES: Record<string, Localized> = {
  not_found: { ar: "العنصر غير موجود.", en: "Not found." },
  invalid_input: { ar: "بعض البيانات غير صالحة.", en: "Some of the data is invalid." },
  invalid_amount: { ar: "المبلغ غير صالح.", en: "Invalid amount." },
  quote_not_draft: { ar: "العرض أُرسل بالفعل ولا يمكن تعديله؛ أنشئ نسخة جديدة.", en: "This quote was already sent." },
  invalid_project_status: {
    ar: "حالة المشروع الحالية لا تسمح بهذه العملية.",
    en: "This action is not possible at the project's current stage.",
  },
  initial_quote_has_payments: {
    ar: "العرض المقبول عليه دفعات أو روابط دفع؛ أي تغيير في النطاق يكون بعرض إضافة.",
    en: "The accepted quote already has payments.",
  },
  terms_required: { ar: "يجب الموافقة على الشروط.", en: "Please accept the terms." },
  waiver_required: {
    ar: "يجب تأكيد طلب البدء فورًا والتنازل عن حق العدول.",
    en: "Please confirm the immediate start and the withdrawal waiver.",
  },
  quote_not_open: { ar: "هذا العرض لم يعد متاحًا للقبول.", en: "This quote is no longer open for acceptance." },
  quote_expired: {
    ar: "انتهت صلاحية هذا العرض. تواصل معنا لتجديده.",
    en: "This quote has expired. Contact us to renew it.",
  },
  otp_no_active_code: { ar: "لا يوجد رمز صالح. اطلب رمزًا جديدًا.", en: "No valid code. Please request a new one." },
  otp_expired: { ar: "انتهت صلاحية الرمز. اطلب رمزًا جديدًا.", en: "The code has expired. Please request a new one." },
  otp_too_many_attempts: {
    ar: "محاولات خاطئة كثيرة. اطلب رمزًا جديدًا.",
    en: "Too many wrong attempts. Please request a new code.",
  },
  otp_invalid_code: { ar: "الرمز غير صحيح.", en: "The code is incorrect." },
  milestone_not_draft: { ar: "يمكن حذف الدفعات المسودة فقط.", en: "Only scheduled payments can be removed." },
  milestone_not_open: { ar: "هذه الدفعة ليست مفتوحة.", en: "This payment is not open." },
  milestone_invalid_status: { ar: "حالة الدفعة لا تسمح بذلك.", en: "Not possible for this payment." },
  tax_invoice_provider_not_configured: {
    ar: "وضع المستندات هو الفاتورة الضريبية عبر مزوّد، ولم يُربط أي مزوّد بعد.",
    en: "Tax invoices are not configured yet.",
  },
  milestones_unpaid: {
    ar: "الملفات النهائية تُفتح فقط بعد سداد كل الدفعات.",
    en: "Final files are released only after all payments.",
  },
  not_released: { ar: "هذا الملف غير متاح بعد.", en: "This file is not available yet." },
  client_email_missing: {
    ar: "لا يوجد بريد إلكتروني للعميل. أضفه من صفحة العميل.",
    en: "We have no email address for you. Please contact us.",
  },
  rate_limited: { ar: "محاولات كثيرة. حاول بعد قليل.", en: "Too many attempts. Please try again shortly." },
  link_invalid: {
    ar: "هذا الرابط لم يعد صالحًا. حدّث الصفحة أو تواصل معنا.",
    en: "This link is no longer valid. Refresh the page or contact us.",
  },
};

const FIELD_LABELS_AR: Record<string, string> = {
  name: "الاسم",
  email: "البريد الإلكتروني",
  phoneE164: "الهاتف (بصيغة دولية مثل ‎+905xxxxxxxxx)",
  country: "رمز البلد من حرفين (مثل SA)",
  title: "العنوان",
  vendor: "المورّد",
  incurredOn: "التاريخ",
  renewsOn: "تاريخ التجديد",
  amountMinor: "المبلغ",
  unitPriceMinor: "سعر البند",
  description: "الوصف",
  lineItems: "البنود",
  clientId: "العميل",
  paymentPlan: "جدول الدفع",
};

function zodMessage(err: ZodError, locale: Locale): string {
  const fields = [...new Set(err.issues.map((i) => String(i.path[0] ?? "")))].filter(Boolean);
  if (locale === "en") return `Invalid data: ${fields.join(", ")}`;
  return `بيانات غير صالحة: ${fields.map((f) => FIELD_LABELS_AR[f] ?? f).join("، ")}`;
}

function postgresCode(err: unknown): string | null {
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof err.code === "string" &&
    /^[0-9A-Z]{5}$/.test(err.code)
  ) {
    return err.code;
  }
  return null;
}

export function describeError(err: unknown, locale: Locale = "ar"): string {
  const pick = (m: Localized) => m[locale];
  if (err instanceof SalesDisabledError) {
    return pick({
      ar: "البيع مطفأ حاليًا (SALES_ENABLED=false): لا قبول عروض ولا روابط دفع ولا تسجيل دفعات حتى صدور التصريح.",
      en: "Online payment opens soon.",
    });
  }
  if (err instanceof TransitionError) {
    if (err.code === "not_allowed")
      return pick({ ar: "هذا الانتقال غير مسموح من الحالة الحالية.", en: "Not allowed." });
    return GUARD_MESSAGES_AR[err.code];
  }
  if (err instanceof DomainError) {
    const known = DOMAIN_MESSAGES[err.code];
    if (err.code === "otp_invalid_code" && typeof err.details?.attemptsLeft === "number") {
      const left = err.details.attemptsLeft;
      return locale === "ar"
        ? `الرمز غير صحيح. المحاولات المتبقية: ${left}.`
        : `The code is incorrect. Attempts left: ${left}.`;
    }
    if (known) return pick(known);
    return locale === "ar" ? `تعذّر تنفيذ العملية (${err.code}).` : "The action could not be completed.";
  }
  if (err instanceof ZodError) return zodMessage(err, locale);
  if (err instanceof MoneyError)
    return pick({ ar: "المبلغ غير صالح (رقم موجب بخانتين عشريتين كحد أقصى).", en: "Invalid amount." });
  if (err instanceof PaymentPlanError) {
    return pick({
      ar: "جدول الدفع يجب أن يساوي إجمالي العرض بالضبط، وكل دفعة أكبر من صفر.",
      en: "Invalid payment plan.",
    });
  }
  if (err instanceof EmailNotConfiguredError) {
    return pick({ ar: "البريد غير مُعدّ (RESEND_API_KEY مطلوب في الإنتاج).", en: "Email is not configured." });
  }
  const code = postgresCode(err);
  if (code === "23514")
    return pick({ ar: "المستند أو العرض مُصدر ولا يمكن تعديله.", en: "This record can no longer be changed." });
  if (code === "23505") return pick({ ar: "القيمة مستخدمة من قبل.", en: "Already exists." });

  console.error("[action] unexpected error", err);
  return pick({ ar: "حدث خطأ غير متوقع. راجع سجل الخادم.", en: "Something went wrong. Please try again." });
}

/** Runs a server action body and converts thrown errors to an ActionState. */
export async function runAction(body: () => Promise<ActionState | void>, locale: Locale = "ar"): Promise<ActionState> {
  try {
    return (await body()) ?? { status: "ok" };
  } catch (err) {
    unstable_rethrow(err);
    return { status: "error", message: describeError(err, locale) };
  }
}
