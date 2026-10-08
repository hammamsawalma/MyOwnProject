/**
 * Small enumerations shared by the database schema and the domain code.
 * (Project statuses live in project-status.ts, milestone kinds in payment-plan.ts.)
 */

export const CLIENT_TYPES = ["individual", "company"] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export const LANGUAGES = ["ar", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export const PRICING_MODELS = ["package", "custom"] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];

export const PACKAGE_TIERS = ["basic", "standard", "premium"] as const;
export type PackageTier = (typeof PACKAGE_TIERS)[number];

export const EVENT_ACTORS = ["admin", "client", "system"] as const;
export type EventActor = (typeof EVENT_ACTORS)[number];

export const QUOTE_KINDS = ["initial", "addon"] as const;
export type QuoteKind = (typeof QUOTE_KINDS)[number];

export const QUOTE_STATUSES = ["draft", "sent", "accepted", "declined", "expired", "superseded"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const DOCUMENT_TYPES = ["quote_pdf", "receipt", "credit_note", "tax_invoice"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** receipt = before tax registration; tax_invoice_via_provider = later (report 07 §5.5). */
export const DOCUMENT_MODES = ["receipt", "tax_invoice_via_provider"] as const;
export type DocumentMode = (typeof DOCUMENT_MODES)[number];

export const DELIVERABLE_KINDS = ["preview", "final"] as const;
export type DeliverableKind = (typeof DELIVERABLE_KINDS)[number];

export const CHANGE_REQUEST_STATUSES = ["open", "quoted", "accepted", "declined", "done", "cancelled"] as const;
export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];

export const OTP_PURPOSES = ["accept_quote", "download_final"] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

export const CONSENT_KINDS = ["terms", "privacy", "eu_withdrawal_waiver", "marketing_optin"] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

export const COST_CATEGORIES = [
  "server",
  "domain",
  "ads",
  "subscription",
  "freelancer",
  "api",
  "whatsapp",
  "other",
] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

export const COST_CATEGORY_LABELS_AR: Record<CostCategory, string> = {
  server: "سيرفرات",
  domain: "دومينات",
  ads: "إعلانات",
  subscription: "اشتراكات",
  freelancer: "أجور الفريق",
  api: "واجهات برمجية (API)",
  whatsapp: "واتساب",
  other: "أخرى",
};

export const RECURRENCES = ["none", "monthly", "yearly"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

export const EMAIL_STATUSES = ["logged", "sent", "failed"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];
