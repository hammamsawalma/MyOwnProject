CREATE TABLE "admin_login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"ip" text,
	"success" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"description" text NOT NULL,
	"requested_by" text NOT NULL,
	"in_scope" boolean,
	"quote_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_requests_status_check" CHECK ("change_requests"."status" in ('open', 'quoted', 'accepted', 'declined', 'done', 'cancelled')),
	CONSTRAINT "change_requests_requested_by_check" CHECK ("change_requests"."requested_by" in ('admin', 'client', 'system'))
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text DEFAULT 'individual' NOT NULL,
	"name" text NOT NULL,
	"company_name" text,
	"email" text,
	"phone_e164" text,
	"country" text,
	"language" text DEFAULT 'ar' NOT NULL,
	"tax_id" text,
	"segment" text,
	"source" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_type_check" CHECK ("clients"."type" in ('individual', 'company')),
	CONSTRAINT "clients_language_check" CHECK ("clients"."language" in ('ar', 'en'))
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"project_id" uuid,
	"quote_id" uuid,
	"kind" text NOT NULL,
	"version" text NOT NULL,
	"granted" boolean DEFAULT true NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consents_kind_check" CHECK ("consents"."kind" in ('terms', 'privacy', 'eu_withdrawal_waiver', 'marketing_optin'))
);
--> statement-breakpoint
CREATE TABLE "costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incurred_on" date NOT NULL,
	"category" text NOT NULL,
	"vendor" text NOT NULL,
	"description" text,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"project_id" uuid,
	"campaign" text,
	"recurring" text DEFAULT 'none' NOT NULL,
	"renews_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "costs_category_check" CHECK ("costs"."category" in ('server', 'domain', 'ads', 'subscription', 'freelancer', 'api', 'whatsapp', 'other')),
	CONSTRAINT "costs_currency_check" CHECK ("costs"."currency" in ('USD', 'EUR')),
	CONSTRAINT "costs_recurring_check" CHECK ("costs"."recurring" in ('none', 'monthly', 'yearly')),
	CONSTRAINT "costs_amount_check" CHECK ("costs"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"file_key" text,
	"external_url" text,
	"file_name" text,
	"mime_type" text,
	"size_bytes" bigint,
	"sha256" text,
	"released" boolean DEFAULT false NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliverables_kind_check" CHECK ("deliverables"."kind" in ('preview', 'final')),
	CONSTRAINT "deliverables_source_check" CHECK ("deliverables"."file_key" is not null or "deliverables"."external_url" is not null)
);
--> statement-breakpoint
CREATE TABLE "document_counters" (
	"series" text NOT NULL,
	"year" integer NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_counters_series_year_pk" PRIMARY KEY("series","year"),
	CONSTRAINT "document_counters_positive" CHECK ("document_counters"."last_number" >= 0)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"type" text NOT NULL,
	"project_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"quote_id" uuid,
	"milestone_id" uuid,
	"reverses_document_id" uuid,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"document_mode" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"pdf_key" text,
	"pdf_sha256" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"immutable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_type_check" CHECK ("documents"."type" in ('quote_pdf', 'receipt', 'credit_note', 'tax_invoice')),
	CONSTRAINT "documents_mode_check" CHECK ("documents"."document_mode" in ('receipt', 'tax_invoice_via_provider')),
	CONSTRAINT "documents_currency_check" CHECK ("documents"."currency" in ('USD', 'EUR')),
	CONSTRAINT "documents_amount_check" CHECK ("documents"."amount_minor" >= 0),
	CONSTRAINT "documents_immutable_check" CHECK ("documents"."immutable" = true)
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"text_body" text NOT NULL,
	"html_body" text,
	"tag" text,
	"project_id" uuid,
	"status" text NOT NULL,
	"provider" text NOT NULL,
	"provider_message_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_outbox_status_check" CHECK ("email_outbox"."status" in ('logged', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "magic_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"last_used_ip" text,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"magic_link_id" uuid,
	"purpose" text NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"consumed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otp_codes_purpose_check" CHECK ("otp_codes"."purpose" in ('accept_quote', 'download_final')),
	CONSTRAINT "otp_codes_attempts_check" CHECK ("otp_codes"."attempts" >= 0 and "otp_codes"."attempts" <= "otp_codes"."max_attempts")
);
--> statement-breakpoint
CREATE TABLE "payment_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"quote_id" uuid,
	"kind" text NOT NULL,
	"sequence" integer NOT NULL,
	"label" text,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"provider" text,
	"provider_ref" text,
	"pay_url" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"evidence_key" text,
	"evidence_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_milestones_kind_check" CHECK ("payment_milestones"."kind" in ('deposit', 'interim', 'balance', 'addon')),
	CONSTRAINT "payment_milestones_status_check" CHECK ("payment_milestones"."status" in ('draft', 'sent', 'paid', 'refunded', 'disputed')),
	CONSTRAINT "payment_milestones_currency_check" CHECK ("payment_milestones"."currency" in ('USD', 'EUR')),
	CONSTRAINT "payment_milestones_amount_check" CHECK ("payment_milestones"."amount_minor" > 0),
	CONSTRAINT "payment_milestones_paid_at_check" CHECK ("payment_milestones"."status" <> 'paid' or "payment_milestones"."paid_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "project_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "project_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"project_id" uuid NOT NULL,
	"type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"actor" text NOT NULL,
	"visible_to_client" boolean DEFAULT false NOT NULL,
	"note" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_events_actor_check" CHECK ("project_events"."actor" in ('admin', 'client', 'system'))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"client_id" uuid NOT NULL,
	"title" text NOT NULL,
	"service_key" text,
	"pricing_model" text DEFAULT 'custom' NOT NULL,
	"package_tier" text,
	"status" text DEFAULT 'lead' NOT NULL,
	"side_from_status" text,
	"currency" text DEFAULT 'USD' NOT NULL,
	"price_total_minor" bigint,
	"revisions_included" integer DEFAULT 0 NOT NULL,
	"revisions_used" integer DEFAULT 0 NOT NULL,
	"warranty_days" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"warranty_ends_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"assigned_machine" text,
	"assigned_person" text,
	"source" text,
	"lost_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_status_check" CHECK ("projects"."status" in ('lead', 'qualified', 'discovery', 'quote_draft', 'quote_sent', 'awaiting_deposit', 'kickoff', 'in_progress', 'internal_qa', 'client_review', 'revisions', 'change_request', 'awaiting_balance', 'delivered', 'warranty', 'closed', 'follow_up', 'on_hold', 'cancelled', 'lost', 'disputed')),
	CONSTRAINT "projects_side_from_check" CHECK ("projects"."side_from_status" in ('lead', 'qualified', 'discovery', 'quote_draft', 'quote_sent', 'awaiting_deposit', 'kickoff', 'in_progress', 'internal_qa', 'client_review', 'revisions', 'change_request', 'awaiting_balance', 'delivered', 'warranty', 'closed', 'follow_up')),
	CONSTRAINT "projects_currency_check" CHECK ("projects"."currency" in ('USD', 'EUR')),
	CONSTRAINT "projects_pricing_model_check" CHECK ("projects"."pricing_model" in ('package', 'custom')),
	CONSTRAINT "projects_package_tier_check" CHECK ("projects"."package_tier" in ('basic', 'standard', 'premium')),
	CONSTRAINT "projects_revisions_check" CHECK ("projects"."revisions_included" >= 0 and "projects"."revisions_used" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quote_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	CONSTRAINT "quote_line_items_amounts_check" CHECK ("quote_line_items"."quantity" > 0 and "quote_line_items"."unit_price_minor" >= 0 and "quote_line_items"."total_minor" = "quote_line_items"."quantity" * "quote_line_items"."unit_price_minor")
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"ref" text,
	"kind" text DEFAULT 'initial' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"pricing_model" text DEFAULT 'custom' NOT NULL,
	"package_tier" text,
	"currency" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"scope_included" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scope_excluded" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"acceptance_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"timeline" text,
	"revisions_included" integer DEFAULT 0 NOT NULL,
	"warranty_days" integer DEFAULT 0 NOT NULL,
	"third_party_costs" text,
	"notes" text,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"payment_plan" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"valid_until" date,
	"terms_version" text,
	"sent_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"accepted_ip" text,
	"accepted_user_agent" text,
	"accepted_terms_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_status_check" CHECK ("quotes"."status" in ('draft', 'sent', 'accepted', 'declined', 'expired', 'superseded')),
	CONSTRAINT "quotes_kind_check" CHECK ("quotes"."kind" in ('initial', 'addon')),
	CONSTRAINT "quotes_currency_check" CHECK ("quotes"."currency" in ('USD', 'EUR')),
	CONSTRAINT "quotes_pricing_model_check" CHECK ("quotes"."pricing_model" in ('package', 'custom')),
	CONSTRAINT "quotes_package_tier_check" CHECK ("quotes"."package_tier" in ('basic', 'standard', 'premium')),
	CONSTRAINT "quotes_amounts_check" CHECK ("quotes"."subtotal_minor" >= 0 and "quotes"."discount_minor" >= 0 and "quotes"."total_minor" = "quotes"."subtotal_minor" - "quotes"."discount_minor"),
	CONSTRAINT "quotes_ref_when_issued_check" CHECK ("quotes"."status" = 'draft' or "quotes"."ref" is not null)
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "costs" ADD CONSTRAINT "costs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_milestone_id_payment_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."payment_milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_reverses_document_id_documents_id_fk" FOREIGN KEY ("reverses_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magic_links" ADD CONSTRAINT "magic_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_magic_link_id_magic_links_id_fk" FOREIGN KEY ("magic_link_id") REFERENCES "public"."magic_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_events" ADD CONSTRAINT "project_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_login_attempts_ip_idx" ON "admin_login_attempts" USING btree ("ip","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_sessions_token_hash_uq" ON "admin_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "change_requests_project_idx" ON "change_requests" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "clients_email_idx" ON "clients" USING btree ("email");--> statement-breakpoint
CREATE INDEX "consents_client_idx" ON "consents" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "consents_quote_idx" ON "consents" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "costs_incurred_idx" ON "costs" USING btree ("incurred_on");--> statement-breakpoint
CREATE INDEX "costs_project_idx" ON "costs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "deliverables_project_idx" ON "deliverables" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_ref_uq" ON "documents" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "documents_project_idx" ON "documents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "email_outbox_created_idx" ON "email_outbox" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "magic_links_token_hash_uq" ON "magic_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "magic_links_project_idx" ON "magic_links" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "otp_codes_lookup_idx" ON "otp_codes" USING btree ("project_id","purpose","created_at");--> statement-breakpoint
CREATE INDEX "payment_milestones_project_idx" ON "payment_milestones" USING btree ("project_id","sequence");--> statement-breakpoint
CREATE INDEX "project_events_project_idx" ON "project_events" USING btree ("project_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_ref_uq" ON "projects" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "projects_client_idx" ON "projects" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "quote_line_items_quote_idx" ON "quote_line_items" USING btree ("quote_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_ref_uq" ON "quotes" USING btree ("ref");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_project_version_uq" ON "quotes" USING btree ("project_id","version");