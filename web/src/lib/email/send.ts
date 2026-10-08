import { desc } from "drizzle-orm";
import { brand } from "@/config/brand";
import { env, isProduction } from "@/config/env";
import type { Db } from "@/db/client";
import { emailOutbox } from "@/db/schema";

/**
 * Email delivery. With RESEND_API_KEY set, messages go through the Resend HTTP
 * API. Without it (development/test), they are printed to the server console and
 * stored in the `email_outbox` table so the admin can read them. In production a
 * missing key is an error: codes and links must never be written to a table/log.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  tag?: string;
  projectId?: string | null;
}

export type EmailResult =
  | { status: "sent"; provider: "resend"; providerMessageId: string | null }
  | { status: "logged"; provider: "console"; outboxId: string }
  | { status: "failed"; provider: "resend"; error: string };

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("RESEND_API_KEY is required in production");
    this.name = "EmailNotConfiguredError";
  }
}

export function defaultFromAddress(): string {
  return env().EMAIL_FROM ?? `${brand.name.en} <no-reply@${brand.domain}>`;
}

export interface SendEmailOptions {
  apiKey?: string;
  from?: string;
  fetchImpl?: typeof fetch;
}

export async function sendEmail(db: Db, message: EmailMessage, options: SendEmailOptions = {}): Promise<EmailResult> {
  const apiKey = options.apiKey ?? env().RESEND_API_KEY;
  if (apiKey) return sendViaResend(message, apiKey, options);
  if (isProduction()) throw new EmailNotConfiguredError();
  return logToOutbox(db, message);
}

async function sendViaResend(message: EmailMessage, apiKey: string, options: SendEmailOptions): Promise<EmailResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: options.from ?? defaultFromAddress(),
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
        tags: message.tag ? [{ name: "category", value: message.tag }] : undefined,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      return { status: "failed", provider: "resend", error: `HTTP ${response.status}: ${body.slice(0, 500)}` };
    }
    const data = (await response.json()) as { id?: string };
    return { status: "sent", provider: "resend", providerMessageId: data.id ?? null };
  } catch (err) {
    return { status: "failed", provider: "resend", error: err instanceof Error ? err.message : String(err) };
  }
}

async function logToOutbox(db: Db, message: EmailMessage): Promise<EmailResult> {
  const [row] = await db
    .insert(emailOutbox)
    .values({
      toEmail: message.to,
      subject: message.subject,
      textBody: message.text,
      htmlBody: message.html ?? null,
      tag: message.tag ?? null,
      projectId: message.projectId ?? null,
      status: "logged",
      provider: "console",
    })
    .returning({ id: emailOutbox.id });
  if (!row) throw new Error("outbox insert failed");
  if (env().NODE_ENV !== "test") {
    console.info(`[email:dev] to=${message.to} subject="${message.subject}"\n${message.text}\n[/email:dev]`);
  }
  return { status: "logged", provider: "console", outboxId: row.id };
}

/** Dev outbox listing for the admin screen (development only). */
export async function listOutbox(db: Db, limit = 50) {
  if (isProduction()) return [];
  return db.select().from(emailOutbox).orderBy(desc(emailOutbox.createdAt)).limit(limit);
}
