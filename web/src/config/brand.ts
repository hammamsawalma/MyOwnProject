import { z } from "zod";
import type { Locale } from "../lib/types";

/**
 * THE single source of brand identity. Name, tagline and domain were decided in
 * Q47/Q48/Q27-a (HazirLab). Colors stay neutral until the visual direction (Q31)
 * is chosen; contact details are placeholders until the WhatsApp number (Q33) and
 * mailbox exist. The issuer block must switch to the registered legal name once
 * the business is registered (Turkish law requires the trader's own name).
 */
export const brand = {
  name: { ar: "حاضر لاب", en: "HazirLab" },
  shortName: { ar: "حاضر لاب", en: "HazirLab" },
  logoText: { ar: "حاضر لاب", en: "HazirLab" },
  tagline: {
    ar: "ذكاءٌ حاضر لأعمالك",
    en: "Smart automation, always ready.",
  },
  domain: "hazirlab.com",
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
    name: { ar: "حاضر لاب", en: "HazirLab" },
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
