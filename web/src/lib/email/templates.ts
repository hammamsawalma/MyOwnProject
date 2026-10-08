import { brand } from "@/config/brand";
import { policy } from "@/config/policy";
import { AR_NOUNS, arCount, enCount } from "@/lib/plural";
import type { Locale } from "@/lib/types";

/** Plain, bilingual-ready transactional emails (one language per message). */

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function layout(locale: Locale, paragraphs: string[]): string {
  const dir = locale === "ar" ? "rtl" : "ltr";
  const body = paragraphs.map((p) => `<p style="margin:0 0 12px">${p}</p>`).join("");
  return `<!doctype html><html lang="${locale}" dir="${dir}"><body style="font-family:Tahoma,Arial,sans-serif;line-height:1.6;color:${brand.colors.foreground}"><div style="max-width:560px;margin:0 auto;padding:24px"><div style="font-weight:bold;color:${brand.colors.primary};margin-bottom:16px">${escapeHtml(brand.name[locale])}</div>${body}</div></body></html>`;
}

const OTP_PURPOSE_TEXT = {
  accept_quote: { ar: "لتأكيد قبول عرض السعر", en: "to confirm accepting the quote" },
  download_final: { ar: "لتنزيل الملفات النهائية", en: "to download the final files" },
} as const;

const greeting = (locale: Locale, name: string) => (locale === "ar" ? `مرحبًا ${name}،` : `Hello ${name},`);
const signOff = (locale: Locale) => (locale === "ar" ? `فريق ${brand.name.ar}` : `The ${brand.name.en} team`);

export function otpEmail(input: {
  locale: Locale;
  code: string;
  purpose: keyof typeof OTP_PURPOSE_TEXT;
  projectTitle: string;
  clientName: string;
}): RenderedEmail {
  const { locale, code, purpose, projectTitle, clientName } = input;
  const minutes = policy.otp.ttlMinutes;
  const [intro, validity, subject] =
    locale === "ar"
      ? [
          `رمز التحقق ${OTP_PURPOSE_TEXT[purpose].ar} في مشروع «${projectTitle}»:`,
          `الرمز صالح لمدة ${arCount(minutes, AR_NOUNS.minute, { oblique: true })} ولمرة واحدة. إن لم تطلبه فتجاهل هذه الرسالة.`,
          `رمز التحقق: ${code}`,
        ]
      : [
          `Your verification code ${OTP_PURPOSE_TEXT[purpose].en} for "${projectTitle}":`,
          `The code is valid for ${enCount(minutes, "minute")} and can be used once. If you did not request it, ignore this email.`,
          `Verification code: ${code}`,
        ];
  const hello = greeting(locale, clientName);
  return {
    subject,
    text: [hello, intro, code, validity, signOff(locale)].join("\n\n"),
    html: layout(locale, [
      escapeHtml(hello),
      escapeHtml(intro),
      `<strong style="font-size:24px;letter-spacing:4px" dir="ltr">${code}</strong>`,
      escapeHtml(validity),
      escapeHtml(signOff(locale)),
    ]),
  };
}

export function portalLinkEmail(input: {
  locale: Locale;
  url: string;
  projectTitle: string;
  clientName: string;
}): RenderedEmail {
  const { locale, url, projectTitle, clientName } = input;
  const [intro, subject] =
    locale === "ar"
      ? [`هذا رابط متابعة مشروعك «${projectTitle}». احتفظ به ولا تشاركه مع أحد.`, `رابط متابعة مشروعك: ${projectTitle}`]
      : [
          `Here is the private tracking link for your project "${projectTitle}". Keep it safe and do not share it.`,
          `Your project tracking link: ${projectTitle}`,
        ];
  const hello = greeting(locale, clientName);
  return {
    subject,
    text: [hello, intro, url, signOff(locale)].join("\n\n"),
    html: layout(locale, [
      escapeHtml(hello),
      escapeHtml(intro),
      `<a href="${escapeHtml(url)}" dir="ltr">${escapeHtml(url)}</a>`,
      escapeHtml(signOff(locale)),
    ]),
  };
}
