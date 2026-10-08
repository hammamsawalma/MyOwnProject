import { sql } from "drizzle-orm";
import { createDb, type DbHandle } from "@/db/client";
import { emailOutbox } from "@/db/schema";
import { desc } from "drizzle-orm";
import { resetEnvCache } from "@/config/env";

export const SALES_ON = { salesEnabled: true } as const;
export const SALES_OFF = { salesEnabled: false } as const;

export function openTestDb(max = 20): DbHandle {
  resetEnvCache();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing in test env");
  return createDb(url, { max });
}

const TABLES = [
  "consents",
  "otp_codes",
  "magic_links",
  "documents",
  "deliverables",
  "change_requests",
  "payment_milestones",
  "quote_line_items",
  "quotes",
  "project_events",
  "costs",
  "email_outbox",
  "projects",
  "clients",
  "document_counters",
  "admin_sessions",
  "admin_login_attempts",
  "rate_limits",
  "settings",
];

/** Empties every table (TRUNCATE bypasses the row-level immutability triggers). */
export async function resetDatabase(handle: DbHandle): Promise<void> {
  await handle.db.execute(sql.raw(`truncate table ${TABLES.join(", ")} restart identity cascade`));
  await handle.db.execute(sql`insert into settings (key, value) values ('document_mode', '"receipt"'::jsonb)`);
}

/** Pulls the latest 6-digit code from the dev email outbox. */
export async function latestOtpFromOutbox(handle: DbHandle): Promise<string> {
  const [mail] = await handle.db.select().from(emailOutbox).orderBy(desc(emailOutbox.createdAt)).limit(1);
  const code = mail?.textBody.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error("No OTP email in outbox");
  return code;
}
