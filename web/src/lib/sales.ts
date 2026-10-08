import { env } from "@/config/env";
import type { Localized } from "./types";

/**
 * Sales kill switch (rule E3: build everything now, collect money only after the
 * work permit). Controlled by the SALES_ENABLED env flag, default false.
 *
 * While disabled: no payment links or pay buttons reach the client, quotes are
 * view-only (acceptance is a sale), milestones can only be drafted, and no payment
 * can be recorded or receipted.
 */

export interface SalesConfig {
  salesEnabled: boolean;
}

export const SALES_ACTIONS = [
  "accept_quote",
  "send_payment_request",
  "show_payment_link",
  "record_payment",
  "issue_receipt",
] as const;

export type SalesAction = (typeof SALES_ACTIONS)[number];

export const SALES_DISABLED_NOTICE: Localized = {
  ar: "الدفع الإلكتروني سيُفتح قريبًا. يمكنك مراجعة العرض الآن، وسنتواصل معك عند فتح الدفع.",
  en: "Online payment opens soon. You can review the quote now, and we will contact you once payment opens.",
};

export function getSalesConfig(): SalesConfig {
  return { salesEnabled: env().SALES_ENABLED };
}

export class SalesDisabledError extends Error {
  readonly code = "SALES_DISABLED";
  constructor(readonly action: SalesAction) {
    super(`Sales are disabled (SALES_ENABLED=false): "${action}" is not allowed`);
    this.name = "SalesDisabledError";
  }
}

export function isSalesActionAllowed(_action: SalesAction, config: SalesConfig = getSalesConfig()): boolean {
  return config.salesEnabled;
}

export function assertSalesEnabled(action: SalesAction, config: SalesConfig = getSalesConfig()): void {
  if (!isSalesActionAllowed(action, config)) throw new SalesDisabledError(action);
}

export interface ClientPaymentPolicy {
  showPaymentLinks: boolean;
  canAcceptQuote: boolean;
  notice: Localized | null;
}

/** What the client page may render about payments. */
export function clientPaymentPolicy(config: SalesConfig = getSalesConfig()): ClientPaymentPolicy {
  return config.salesEnabled
    ? { showPaymentLinks: true, canAcceptQuote: true, notice: null }
    : { showPaymentLinks: false, canAcceptQuote: false, notice: SALES_DISABLED_NOTICE };
}

/** Strips the payment URL from a milestone unless the client may see it. */
export function redactPaymentLink<T extends { payUrl: string | null; status: string }>(
  milestone: T,
  config: SalesConfig = getSalesConfig(),
): T {
  const visible = config.salesEnabled && milestone.status === "sent";
  return visible ? milestone : { ...milestone, payUrl: null };
}
