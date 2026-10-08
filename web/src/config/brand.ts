import { z } from "zod";
import type { Locale } from "../lib/types";

/**
 * THE single source of brand identity. The final name is not chosen yet
 * (candidates: HazirLab / Labeeb Studio, decision Q26), so everything below is a
 * neutral placeholder. To rebrand, edit only this object; the UI, emails and PDFs
 * read from it.
 */
export const brand = {
  name: { ar: "الاستوديو التقني", en: "Tech Studio" },
  shortName: { ar: "الاستوديو", en: "Studio" },
  logoText: { ar: "الاستوديو", en: "STUDIO" },
  tagline: {
    ar: "أتمتة وذكاء اصطناعي للأعمال",
    en: "Automation & AI for businesses",
  },
  domain: "example.com",
  colors: {
    primary: "#1E3A5F",
    primaryForeground: "#FFFFFF",
    accent: "#2F80ED",
    background: "#FFFFFF",
    foreground: "#111827",
    muted: "#6B7280",
    border: "#E5E7EB",
  },
  contact: {
    /** E.164 without spaces, e.g. "+905xxxxxxxxx". Empty = not configured yet. */
    whatsappE164: "",
    email: "hello@example.com",
  },
  /** Issuer block printed on quotes and receipts. */
  issuer: {
    name: { ar: "الاستوديو التقني", en: "Tech Studio" },
    country: { ar: "تركيا", en: "Türkiye" },
  },
} as const;

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const localized = z.object({ ar: z.string().min(1), en: z.string().min(1) });

export const BrandSchema = z.object({
  name: localized,
  shortName: localized,
  logoText: localized,
  tagline: localized,
  domain: z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/),
  colors: z.object({
    primary: hexColor,
    primaryForeground: hexColor,
    accent: hexColor,
    background: hexColor,
    foreground: hexColor,
    muted: hexColor,
    border: hexColor,
  }),
  contact: z.object({
    whatsappE164: z.union([z.literal(""), z.string().regex(/^\+[1-9]\d{6,14}$/)]),
    email: z.email(),
  }),
  issuer: z.object({ name: localized, country: localized }),
});

export type Brand = z.infer<typeof BrandSchema>;

export function brandName(locale: Locale = "ar", b: Brand = brand): string {
  return b.name[locale];
}

/** wa.me link, or null while no WhatsApp number is configured. */
export function whatsappUrl(text?: string, b: Brand = brand): string | null {
  if (!b.contact.whatsappE164) return null;
  const digits = b.contact.whatsappE164.replace(/\D/g, "");
  const query = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${digits}${query}`;
}

/** CSS custom properties consumed by Tailwind theme tokens in globals.css. */
export function brandCssVariables(b: Brand = brand): Record<string, string> {
  return {
    "--brand-primary": b.colors.primary,
    "--brand-primary-foreground": b.colors.primaryForeground,
    "--brand-accent": b.colors.accent,
    "--brand-background": b.colors.background,
    "--brand-foreground": b.colors.foreground,
    "--brand-muted": b.colors.muted,
    "--brand-border": b.colors.border,
  };
}
