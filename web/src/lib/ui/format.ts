import { env } from "@/config/env";
import type { Locale } from "@/lib/types";

/**
 * Server-side date formatting in the business time zone, with Western digits
 * in both languages (consistent with document numbers and amounts).
 */

const TAGS: Record<Locale, string> = { ar: "ar-u-nu-latn", en: "en-GB" };

function toDate(value: Date | string): Date {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`)
    : new Date(value);
}

export function formatDate(value: Date | string | null | undefined, locale: Locale = "ar"): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(TAGS[locale], { dateStyle: "medium", timeZone: env().BUSINESS_TIMEZONE }).format(
    toDate(value),
  );
}

export function formatDateTime(value: Date | string | null | undefined, locale: Locale = "ar"): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(TAGS[locale], {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: env().BUSINESS_TIMEZONE,
  }).format(toDate(value));
}

/** YYYY-MM-DD of `value` in the business time zone (for <input type="date">). */
export function dateInputValue(value: Date | null | undefined = new Date()): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: env().BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

/** Midday of a YYYY-MM-DD date in UTC: stable for date-only fields regardless of offset. */
export function parseDateInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** First and last day (YYYY-MM-DD) of a YYYY-MM month. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function formatMonth(month: string, locale: Locale = "ar"): string {
  return new Intl.DateTimeFormat(TAGS[locale], { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}-15T00:00:00Z`),
  );
}
