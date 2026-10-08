import { brand } from "@/config/brand";
import { policy } from "@/config/policy";
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

export function otpEmail(input: {
  locale: Locale;
  code: string;
  purpose: keyof typeof OTP_PURPOSE_TEXT;
  projectTitle: string;
}): RenderedEmail {
  const { locale, code, purpose, projectTitle } = input;
  const minutes = policy.otp.ttlMinutes;
  if (locale === "ar") {
    const lines = [
      `رمز التحقق ${OTP_PURPOSE_TEXT[purpose].ar} في مشروع "${projectTitle}":`,
      code,
      `الرمز صالح ${minutes} دقائق ولمرة واحدة. إن لم تطلبه فتجاهل هذه الرسالة.`,
    ];
    return {
      subject: `رمز التحقق: ${code}`,
      text: lines.join("\n\n"),
      html: layout("ar", [
        escapeHtml(lines[0] ?? ""),
        `<strong style="font-size:24px;letter-spacing:4px" dir="ltr">${code}</strong>`,
        escapeHtml(lines[2] ?? ""),
      ]),
    };
  }
  const lines = [
    `Your verification code ${OTP_PURPOSE_TEXT[purpose].en} for "${projectTitle}":`,
    code,
    `The code is valid for ${minutes} minutes and can be used once. If you did not request it, ignore this email.`,
  ];
  return {
    subject: `Verification code: ${code}`,
    text: lines.join("\n\n"),
    html: layout("en", [
      escapeHtml(lines[0] ?? ""),
      `<strong style="font-size:24px;letter-spacing:4px">${code}</strong>`,
      escapeHtml(lines[2] ?? ""),
    ]),
  };
}

export function portalLinkEmail(input: { locale: Locale; url: string; projectTitle: string }): RenderedEmail {
  const { locale, url, projectTitle } = input;
  if (locale === "ar") {
    const intro = `هذا رابط متابعة مشروعك "${projectTitle}". احتفظ به ولا تشاركه مع أحد.`;
    return {
      subject: `رابط متابعة مشروعك: ${projectTitle}`,
      text: `${intro}\n\n${url}`,
      html: layout("ar", [escapeHtml(intro), `<a href="${escapeHtml(url)}" dir="ltr">${escapeHtml(url)}</a>`]),
    };
  }
  const intro = `Here is the private tracking link for your project "${projectTitle}". Keep it safe and do not share it.`;
  return {
    subject: `Your project tracking link: ${projectTitle}`,
    text: `${intro}\n\n${url}`,
    html: layout("en", [escapeHtml(intro), `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`]),
  };
}
