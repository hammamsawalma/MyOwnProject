import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { EmailNotConfiguredError } from "@/lib/email/send";
import { DomainError } from "@/lib/errors";
import { MoneyError } from "@/lib/money";
import { PaymentPlanError } from "@/lib/payment-plan";
import { GUARD_MESSAGES_AR, TransitionError } from "@/lib/project-status";
import { SALES_DISABLED_NOTICE, SalesDisabledError } from "@/lib/sales";
import type { Locale, Localized } from "@/lib/types";
import type { ActionState } from "./action-state";

/**
 * Maps thrown errors to short user-facing messages. Two audiences:
 * - admin (Arabic only): may name settings such as CHROMIUM_PATH or RESEND_API_KEY;
 * - client (Arabic or English, the tracking page): calm wording only, never env
 *   names, error codes, internal states or the reason sales are off.
 */

const ADMIN_MESSAGES: Record<string, string> = {
  not_found: "العنصر غير موجود.",
  invalid_input: "بعض البيانات غير صالحة.",
  invalid_amount: "المبلغ غير صالح.",
  quote_not_draft: "العرض أُرسل بالفعل ولا يمكن تعديله؛ أنشئ نسخة جديدة.",
  invalid_project_status: "حالة المشروع الحالية لا تسمح بهذه العملية.",
  initial_quote_has_payments: "العرض المقبول عليه دفعات أو روابط دفع؛ أي تغيير في النطاق يكون بعرض إضافة.",
  terms_required: "يجب الموافقة على الشروط.",
  waiver_required: "يجب تأكيد طلب البدء فورًا والتنازل عن حق العدول.",
  quote_not_open: "هذا العرض لم يعد متاحًا للقبول.",
  quote_expired: "انتهت صلاحية هذا العرض.",
  currency_mismatch: "عملة عروض الإضافة والدفعات اليدوية يجب أن تطابق عملة المشروع.",
  otp_no_active_code: "لا يوجد رمز صالح. اطلب رمزًا جديدًا.",
  otp_expired: "انتهت صلاحية الرمز. اطلب رمزًا جديدًا.",
  otp_too_many_attempts: "محاولات خاطئة كثيرة. اطلب رمزًا جديدًا.",
  otp_invalid_code: "الرمز غير صحيح.",
  milestone_not_draft: "يمكن حذف الدفعات المسودة فقط.",
  milestone_agreed:
    "هذه الدفعة جزء من جدول الدفع المتفق عليه في عرض مقبول، فلا تُحذف. تغيير الجدول يكون بنسخة جديدة من العرض (قبل أي دفع) أو بعرض إضافة.",
  milestone_not_open: "هذه الدفعة ليست مفتوحة.",
  milestone_invalid_status: "حالة الدفعة لا تسمح بذلك.",
  tax_invoice_provider_not_configured: "وضع المستندات هو الفاتورة الضريبية عبر مزوّد، ولم يُربط أي مزوّد بعد.",
  milestones_unpaid: "الملفات النهائية تُفتح فقط بعد سداد كل الدفعات.",
  not_released: "هذا الملف غير متاح بعد.",
  client_email_missing: "لا يوجد بريد إلكتروني للعميل. أضفه من صفحة العميل.",
  email_failed:
    "تعذّر إرسال البريد الآن، ولم يتغير شيء (الرابط السابق ما زال فعّالًا). تحقق من إعداد Resend (المفتاح وتوثيق النطاق) ثم أعد المحاولة.",
  rate_limited: "محاولات كثيرة. حاول بعد قليل.",
  link_invalid: "هذا الرابط لم يعد صالحًا.",
};

const CLIENT_GENERIC: Localized = {
  ar: "تعذّر إتمام العملية الآن. حاول مرة أخرى بعد قليل أو تواصل معنا.",
  en: "We could not complete this right now. Please try again shortly or contact us.",
};

/** The only domain errors a client can trigger; anything else gets CLIENT_GENERIC. */
const CLIENT_MESSAGES: Record<string, Localized> = {
  terms_required: { ar: "يرجى الموافقة على الشروط.", en: "Please accept the terms." },
  waiver_required: {
    ar: "يرجى تأكيد طلب البدء فورًا والتنازل عن حق العدول.",
    en: "Please confirm the immediate start and the withdrawal waiver.",
  },
  quote_not_open: { ar: "هذا العرض لم يعد متاحًا للقبول.", en: "This quote is no longer open for acceptance." },
  invalid_project_status: {
    ar: "لا يمكن قبول هذا العرض في المرحلة الحالية من المشروع. تواصل معنا.",
    en: "This quote cannot be accepted at the project's current stage. Please contact us.",
  },
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
  milestones_unpaid: { ar: "هذا الملف غير متاح حاليًا.", en: "This file is not available right now." },
  not_released: { ar: "هذا الملف غير متاح بعد.", en: "This file is not available yet." },
  client_email_missing: {
    ar: "لا يوجد بريد إلكتروني مسجّل لك. تواصل معنا لإضافته.",
    en: "We have no email address for you. Please contact us to add one.",
  },
  email_failed: {
    ar: "تعذّر إرسال الرمز الآن. حاول مرة أخرى بعد قليل أو تواصل معنا.",
    en: "We could not send the code right now. Please try again shortly or contact us.",
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

function attemptsLeft(err: DomainError): number | null {
  return err.code === "otp_invalid_code" && typeof err.details?.attemptsLeft === "number"
    ? err.details.attemptsLeft
    : null;
}

/** Admin wording (Arabic). */
export function describeError(err: unknown): string {
  if (err instanceof SalesDisabledError) {
    return "البيع مطفأ حاليًا (SALES_ENABLED=false): لا قبول عروض ولا روابط دفع ولا تسجيل دفعات حتى صدور التصريح.";
  }
  if (err instanceof TransitionError) {
    return err.code === "not_allowed" ? "هذا الانتقال غير مسموح من الحالة الحالية." : GUARD_MESSAGES_AR[err.code];
  }
  if (err instanceof DomainError) {
    const left = attemptsLeft(err);
    if (left !== null) return `الرمز غير صحيح. المحاولات المتبقية: ${left}.`;
    return ADMIN_MESSAGES[err.code] ?? `تعذّر تنفيذ العملية (${err.code}).`;
  }
  if (err instanceof ZodError) {
    const fields = [...new Set(err.issues.map((i) => String(i.path[0] ?? "")))].filter(Boolean);
    return `بيانات غير صالحة: ${fields.map((f) => FIELD_LABELS_AR[f] ?? f).join("، ")}`;
  }
  if (err instanceof MoneyError) return "المبلغ غير صالح (رقم موجب بخانتين عشريتين كحد أقصى).";
  if (err instanceof PaymentPlanError) return "جدول الدفع يجب أن يساوي إجمالي العرض بالضبط، وكل دفعة أكبر من صفر.";
  if (err instanceof EmailNotConfiguredError) return "البريد غير مُعدّ (RESEND_API_KEY مطلوب في الإنتاج).";
  const code = postgresCode(err);
  if (code === "23514") return "المستند أو العرض مُصدر ولا يمكن تعديله.";
  if (code === "23505") return "القيمة مستخدمة من قبل.";

  console.error("[action] unexpected error", err);
  return "حدث خطأ غير متوقع. راجع سجل الخادم.";
}

/** Client wording for the tracking page (Arabic or English). */
export function describeClientError(err: unknown, locale: Locale): string {
  if (err instanceof SalesDisabledError) return SALES_DISABLED_NOTICE[locale];
  if (err instanceof DomainError) {
    const left = attemptsLeft(err);
    if (left !== null) {
      return locale === "ar"
        ? `الرمز غير صحيح. المحاولات المتبقية: ${left}.`
        : `The code is incorrect. Attempts left: ${left}.`;
    }
    const known = CLIENT_MESSAGES[err.code];
    if (known) return known[locale];
  }
  if (err instanceof EmailNotConfiguredError) return CLIENT_MESSAGES.email_failed![locale];
  if (!(err instanceof DomainError)) console.error("[portal action] unexpected error", err);
  return CLIENT_GENERIC[locale];
}

async function run(body: () => Promise<ActionState | void>, describe: (err: unknown) => string): Promise<ActionState> {
  try {
    return (await body()) ?? { status: "ok" };
  } catch (err) {
    unstable_rethrow(err);
    return { status: "error", message: describe(err) };
  }
}

/** Runs an admin server action body and converts thrown errors to an ActionState. */
export function runAction(body: () => Promise<ActionState | void>): Promise<ActionState> {
  return run(body, describeError);
}

/** Same for client portal actions, with client wording in the client's language. */
export function runClientAction(body: () => Promise<ActionState | void>, locale: Locale): Promise<ActionState> {
  return run(body, (err) => describeClientError(err, locale));
}
