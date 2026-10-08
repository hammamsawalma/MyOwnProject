import { sql, type SQL } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
// Relative imports only: drizzle-kit loads this file without tsconfig path aliases.
import type { DocumentSnapshot } from "../lib/documents/snapshots";
import { CURRENCIES } from "../lib/money";
import { MILESTONE_KINDS, MILESTONE_STATUSES, type PlannedMilestone } from "../lib/payment-plan";
import { MAIN_STATUSES, PROJECT_STATUSES } from "../lib/project-status";
import {
  CHANGE_REQUEST_STATUSES,
  CLIENT_TYPES,
  CONSENT_KINDS,
  COST_CATEGORIES,
  DELIVERABLE_KINDS,
  DOCUMENT_MODES,
  DOCUMENT_TYPES,
  EMAIL_STATUSES,
  EVENT_ACTORS,
  LANGUAGES,
  OTP_PURPOSES,
  PACKAGE_TIERS,
  PRICING_MODELS,
  QUOTE_KINDS,
  QUOTE_STATUSES,
  RECURRENCES,
} from "../lib/domain-enums";

/** CHECK (column IN ('a','b',...)) built from the TypeScript constants. */
function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  const list = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
  return sql`${column} in (${sql.raw(list)})`;
}

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const money = (name: string) => bigint(name, { mode: "number" });

// ---------------------------------------------------------------------------
// Clients and projects
// ---------------------------------------------------------------------------

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type", { enum: CLIENT_TYPES }).notNull().default("individual"),
    name: text("name").notNull(),
    companyName: text("company_name"),
    email: text("email"),
    phoneE164: text("phone_e164"),
    /** ISO 3166-1 alpha-2. */
    country: text("country"),
    language: text("language", { enum: LANGUAGES }).notNull().default("ar"),
    taxId: text("tax_id"),
    segment: text("segment"),
    source: text("source"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("clients_email_idx").on(t.email),
    check("clients_type_check", oneOf(t.type, CLIENT_TYPES)),
    check("clients_language_check", oneOf(t.language, LANGUAGES)),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** P-YYYY-NNNN */
    ref: text("ref").notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    title: text("title").notNull(),
    serviceKey: text("service_key"),
    pricingModel: text("pricing_model", { enum: PRICING_MODELS }).notNull().default("custom"),
    packageTier: text("package_tier", { enum: PACKAGE_TIERS }),
    status: text("status", { enum: PROJECT_STATUSES }).notNull().default("lead"),
    /** Main status before entering on_hold/disputed/cancelled/lost (to resume). */
    sideFromStatus: text("side_from_status", { enum: MAIN_STATUSES }),
    currency: text("currency", { enum: CURRENCIES }).notNull().default("USD"),
    priceTotalMinor: money("price_total_minor"),
    revisionsIncluded: integer("revisions_included").notNull().default(0),
    revisionsUsed: integer("revisions_used").notNull().default(0),
    warrantyDays: integer("warranty_days").notNull().default(0),
    dueAt: timestamp("due_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    warrantyEndsAt: timestamp("warranty_ends_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    assignedMachine: text("assigned_machine"),
    assignedPerson: text("assigned_person"),
    source: text("source"),
    lostReason: text("lost_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("projects_ref_uq").on(t.ref),
    index("projects_client_idx").on(t.clientId),
    index("projects_status_idx").on(t.status),
    check("projects_status_check", oneOf(t.status, PROJECT_STATUSES)),
    check("projects_side_from_check", oneOf(t.sideFromStatus, MAIN_STATUSES)),
    check("projects_currency_check", oneOf(t.currency, CURRENCIES)),
    check("projects_pricing_model_check", oneOf(t.pricingModel, PRICING_MODELS)),
    check("projects_package_tier_check", oneOf(t.packageTier, PACKAGE_TIERS)),
    check("projects_revisions_check", sql`${t.revisionsIncluded} >= 0 and ${t.revisionsUsed} >= 0`),
  ],
);

export const projectEvents = pgTable(
  "project_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Insertion order; several events can share a timestamp inside one transaction. */
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    type: text("type").notNull(),
    fromStatus: text("from_status", { enum: PROJECT_STATUSES }),
    toStatus: text("to_status", { enum: PROJECT_STATUSES }),
    actor: text("actor", { enum: EVENT_ACTORS }).notNull(),
    visibleToClient: boolean("visible_to_client").notNull().default(false),
    /** Internal note; never shown to the client. */
    note: text("note"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("project_events_project_idx").on(t.projectId, t.seq),
    check("project_events_actor_check", oneOf(t.actor, EVENT_ACTORS)),
  ],
);

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    version: integer("version").notNull(),
    /** Q-YYYY-NNNN, assigned when the quote is sent (issued). */
    ref: text("ref"),
    kind: text("kind", { enum: QUOTE_KINDS }).notNull().default("initial"),
    status: text("status", { enum: QUOTE_STATUSES }).notNull().default("draft"),
    pricingModel: text("pricing_model", { enum: PRICING_MODELS }).notNull().default("custom"),
    packageTier: text("package_tier", { enum: PACKAGE_TIERS }),
    currency: text("currency", { enum: CURRENCIES }).notNull(),
    title: text("title").notNull(),
    /** Client's need in 2-3 lines (report 09 §4.11). */
    summary: text("summary"),
    scopeIncluded: jsonb("scope_included").$type<string[]>().notNull().default([]),
    scopeExcluded: jsonb("scope_excluded").$type<string[]>().notNull().default([]),
    assumptions: jsonb("assumptions").$type<string[]>().notNull().default([]),
    acceptanceCriteria: jsonb("acceptance_criteria").$type<string[]>().notNull().default([]),
    timeline: text("timeline"),
    revisionsIncluded: integer("revisions_included").notNull().default(0),
    warrantyDays: integer("warranty_days").notNull().default(0),
    thirdPartyCosts: text("third_party_costs"),
    notes: text("notes"),
    subtotalMinor: money("subtotal_minor").notNull().default(0),
    discountMinor: money("discount_minor").notNull().default(0),
    totalMinor: money("total_minor").notNull().default(0),
    paymentPlan: jsonb("payment_plan").$type<PlannedMilestone[]>().notNull().default([]),
    validUntil: date("valid_until", { mode: "string" }),
    termsVersion: text("terms_version"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedIp: text("accepted_ip"),
    acceptedUserAgent: text("accepted_user_agent"),
    acceptedTermsVersion: text("accepted_terms_version"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("quotes_ref_uq").on(t.ref),
    uniqueIndex("quotes_project_version_uq").on(t.projectId, t.version),
    check("quotes_status_check", oneOf(t.status, QUOTE_STATUSES)),
    check("quotes_kind_check", oneOf(t.kind, QUOTE_KINDS)),
    check("quotes_currency_check", oneOf(t.currency, CURRENCIES)),
    check("quotes_pricing_model_check", oneOf(t.pricingModel, PRICING_MODELS)),
    check("quotes_package_tier_check", oneOf(t.packageTier, PACKAGE_TIERS)),
    check(
      "quotes_amounts_check",
      sql`${t.subtotalMinor} >= 0 and ${t.discountMinor} >= 0 and ${t.totalMinor} = ${t.subtotalMinor} - ${t.discountMinor}`,
    ),
    check("quotes_ref_when_issued_check", sql`${t.status} = 'draft' or ${t.ref} is not null`),
  ],
);

export const quoteLineItems = pgTable(
  "quote_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitPriceMinor: money("unit_price_minor").notNull(),
    totalMinor: money("total_minor").notNull(),
  },
  (t) => [
    index("quote_line_items_quote_idx").on(t.quoteId, t.position),
    check(
      "quote_line_items_amounts_check",
      sql`${t.quantity} > 0 and ${t.unitPriceMinor} >= 0 and ${t.totalMinor} = ${t.quantity} * ${t.unitPriceMinor}`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Payments, documents, deliverables, change requests
// ---------------------------------------------------------------------------

export const paymentMilestones = pgTable(
  "payment_milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    quoteId: uuid("quote_id").references(() => quotes.id),
    kind: text("kind", { enum: MILESTONE_KINDS }).notNull(),
    sequence: integer("sequence").notNull(),
    label: text("label"),
    amountMinor: money("amount_minor").notNull(),
    currency: text("currency", { enum: CURRENCIES }).notNull(),
    /** e.g. "payoneer", "bank_transfer"; free text until the provider decision (Q8). */
    provider: text("provider"),
    providerRef: text("provider_ref"),
    payUrl: text("pay_url"),
    status: text("status", { enum: MILESTONE_STATUSES }).notNull().default("draft"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    evidenceKey: text("evidence_key"),
    evidenceNote: text("evidence_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("payment_milestones_project_idx").on(t.projectId, t.sequence),
    check("payment_milestones_kind_check", oneOf(t.kind, MILESTONE_KINDS)),
    check("payment_milestones_status_check", oneOf(t.status, MILESTONE_STATUSES)),
    check("payment_milestones_currency_check", oneOf(t.currency, CURRENCIES)),
    check("payment_milestones_amount_check", sql`${t.amountMinor} > 0`),
    check("payment_milestones_paid_at_check", sql`${t.status} <> 'paid' or ${t.paidAt} is not null`),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Q-/R-/CN-YYYY-NNNN, gapless per series and year. */
    ref: text("ref").notNull(),
    type: text("type", { enum: DOCUMENT_TYPES }).notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    quoteId: uuid("quote_id").references(() => quotes.id),
    milestoneId: uuid("milestone_id").references(() => paymentMilestones.id),
    reversesDocumentId: uuid("reverses_document_id").references((): AnyPgColumn => documents.id),
    currency: text("currency", { enum: CURRENCIES }).notNull(),
    amountMinor: money("amount_minor").notNull(),
    documentMode: text("document_mode", { enum: DOCUMENT_MODES }).notNull(),
    /** Everything needed to re-render the PDF exactly as issued. */
    snapshot: jsonb("snapshot").$type<DocumentSnapshot>().notNull(),
    pdfKey: text("pdf_key"),
    pdfSha256: text("pdf_sha256"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    immutable: boolean("immutable").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("documents_ref_uq").on(t.ref),
    index("documents_project_idx").on(t.projectId),
    check("documents_type_check", oneOf(t.type, DOCUMENT_TYPES)),
    check("documents_mode_check", oneOf(t.documentMode, DOCUMENT_MODES)),
    check("documents_currency_check", oneOf(t.currency, CURRENCIES)),
    check("documents_amount_check", sql`${t.amountMinor} >= 0`),
    check("documents_immutable_check", sql`${t.immutable} = true`),
  ],
);

export const deliverables = pgTable(
  "deliverables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    kind: text("kind", { enum: DELIVERABLE_KINDS }).notNull(),
    title: text("title").notNull(),
    /** Local storage key (see lib/storage.ts) ... */
    fileKey: text("file_key"),
    /** ... or an external link (e.g. a staging URL or a video for previews). */
    externalUrl: text("external_url"),
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    sha256: text("sha256"),
    released: boolean("released").notNull().default(false),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("deliverables_project_idx").on(t.projectId),
    check("deliverables_kind_check", oneOf(t.kind, DELIVERABLE_KINDS)),
    check("deliverables_source_check", sql`${t.fileKey} is not null or ${t.externalUrl} is not null`),
  ],
);

export const changeRequests = pgTable(
  "change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    description: text("description").notNull(),
    requestedBy: text("requested_by", { enum: EVENT_ACTORS }).notNull(),
    /** null = not assessed yet; true = a revision within scope; false = out of scope. */
    inScope: boolean("in_scope"),
    quoteId: uuid("quote_id").references(() => quotes.id),
    status: text("status", { enum: CHANGE_REQUEST_STATUSES }).notNull().default("open"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("change_requests_project_idx").on(t.projectId),
    check("change_requests_status_check", oneOf(t.status, CHANGE_REQUEST_STATUSES)),
    check("change_requests_requested_by_check", oneOf(t.requestedBy, EVENT_ACTORS)),
  ],
);

// ---------------------------------------------------------------------------
// Client access: magic links, one-time codes, consents
// ---------------------------------------------------------------------------

export const magicLinks = pgTable(
  "magic_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    /** SHA-256 hex of the token; the token itself is never stored. */
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    lastUsedIp: text("last_used_ip"),
    useCount: integer("use_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("magic_links_token_hash_uq").on(t.tokenHash),
    index("magic_links_project_idx").on(t.projectId),
  ],
);

export const otpCodes = pgTable(
  "otp_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    magicLinkId: uuid("magic_link_id").references(() => magicLinks.id),
    purpose: text("purpose", { enum: OTP_PURPOSES }).notNull(),
    email: text("email").notNull(),
    /** HMAC-SHA256(APP_SECRET, id:code); the code itself is never stored. */
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("otp_codes_lookup_idx").on(t.projectId, t.purpose, t.createdAt),
    check("otp_codes_purpose_check", oneOf(t.purpose, OTP_PURPOSES)),
    check("otp_codes_attempts_check", sql`${t.attempts} >= 0 and ${t.attempts} <= ${t.maxAttempts}`),
  ],
);

export const consents = pgTable(
  "consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    projectId: uuid("project_id").references(() => projects.id),
    quoteId: uuid("quote_id").references(() => quotes.id),
    kind: text("kind", { enum: CONSENT_KINDS }).notNull(),
    version: text("version").notNull(),
    granted: boolean("granted").notNull().default(true),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [
    index("consents_client_idx").on(t.clientId),
    index("consents_quote_idx").on(t.quoteId),
    check("consents_kind_check", oneOf(t.kind, CONSENT_KINDS)),
  ],
);

// ---------------------------------------------------------------------------
// Operations: costs, counters, settings, email outbox, admin auth
// ---------------------------------------------------------------------------

export const costs = pgTable(
  "costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    incurredOn: date("incurred_on", { mode: "string" }).notNull(),
    category: text("category", { enum: COST_CATEGORIES }).notNull(),
    vendor: text("vendor").notNull(),
    description: text("description"),
    amountMinor: money("amount_minor").notNull(),
    currency: text("currency", { enum: CURRENCIES }).notNull(),
    projectId: uuid("project_id").references(() => projects.id),
    campaign: text("campaign"),
    recurring: text("recurring", { enum: RECURRENCES }).notNull().default("none"),
    renewsOn: date("renews_on", { mode: "string" }),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("costs_incurred_idx").on(t.incurredOn),
    index("costs_project_idx").on(t.projectId),
    check("costs_category_check", oneOf(t.category, COST_CATEGORIES)),
    check("costs_currency_check", oneOf(t.currency, CURRENCIES)),
    check("costs_recurring_check", oneOf(t.recurring, RECURRENCES)),
    check("costs_amount_check", sql`${t.amountMinor} >= 0`),
  ],
);

/** Gapless numbering: one locked row per series and year (see lib/numbering.ts). */
export const documentCounters = pgTable(
  "document_counters",
  {
    series: text("series").notNull(),
    year: integer("year").notNull(),
    lastNumber: integer("last_number").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.series, t.year] }), check("document_counters_positive", sql`${t.lastNumber} >= 0`)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});

export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    textBody: text("text_body").notNull(),
    htmlBody: text("html_body"),
    tag: text("tag"),
    projectId: uuid("project_id").references(() => projects.id),
    status: text("status", { enum: EMAIL_STATUSES }).notNull(),
    provider: text("provider").notNull(),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [
    index("email_outbox_created_idx").on(t.createdAt),
    check("email_outbox_status_check", oneOf(t.status, EMAIL_STATUSES)),
  ],
);

export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    ip: text("ip"),
    userAgent: text("user_agent"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("admin_sessions_token_hash_uq").on(t.tokenHash)],
);

export const adminLoginAttempts = pgTable(
  "admin_login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    ip: text("ip"),
    success: boolean("success").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("admin_login_attempts_ip_idx").on(t.ip, t.createdAt)],
);

/** Fixed-window counters for rate limiting (see lib/rate-limit.ts). */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
});
