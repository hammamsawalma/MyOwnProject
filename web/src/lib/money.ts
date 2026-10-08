/**
 * Money is always an integer number of minor units (cents) plus a currency.
 * Only USD and EUR are supported (decision Q14). Payment fees are included in
 * prices, so there is no surcharge helper on purpose.
 */

export const CURRENCIES = ["USD", "EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];

const MINOR_DIGITS: Record<Currency, number> = { USD: 2, EUR: 2 };

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);
}

export function assertCurrency(value: unknown): Currency {
  if (!isCurrency(value)) throw new MoneyError(`Unsupported currency: ${String(value)} (USD or EUR only)`);
  return value;
}

export function assertMinor(value: number): number {
  if (!Number.isSafeInteger(value)) throw new MoneyError(`Amount must be an integer number of minor units: ${value}`);
  return value;
}

/** Major units (e.g. 150) to minor units (15000). Throws on sub-cent precision. */
export function toMinor(major: number, currency: Currency): number {
  const factor = 10 ** MINOR_DIGITS[currency];
  const minor = Math.round(major * factor);
  if (Math.abs(minor / factor - major) > 1e-9) {
    throw new MoneyError(`Too many decimal places for ${currency}: ${major}`);
  }
  return assertMinor(minor);
}

/**
 * Parses user input such as "1,250.50" or "1250" into minor units.
 * Accepts Arabic-Indic digits too. Rejects negatives and more than 2 decimals.
 */
export function parseMoney(input: string, currency: Currency): number {
  const normalized = input
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[,\s٬]/g, "")
    .replace(/٫/g, ".");
  const digits = MINOR_DIGITS[currency];
  const match = new RegExp(`^(\\d+)(?:\\.(\\d{1,${digits}}))?$`).exec(normalized);
  if (!match) throw new MoneyError(`Invalid amount: "${input}"`);
  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(digits, "0");
  return assertMinor(Number(whole) * 10 ** digits + Number(fraction || "0"));
}

export function fromMinor(minor: number, currency: Currency): number {
  return assertMinor(minor) / 10 ** MINOR_DIGITS[currency];
}

/**
 * Locale-aware formatting. Western digits are used in both languages so amounts
 * match document numbers (Q-2026-0001) and render consistently in PDFs. Arabic
 * shows dollars as "1,250.00 USD" (ICU's "US$" is unusual for Arabic readers and
 * the documents name the currency as USD); euros keep the € sign.
 */
export function formatMoney(minor: number, currency: Currency, locale: "ar" | "en" = "ar"): string {
  const tag = locale === "ar" ? "ar-u-nu-latn" : "en-US";
  return new Intl.NumberFormat(tag, {
    style: "currency",
    currency,
    currencyDisplay: locale === "ar" && currency === "USD" ? "code" : "symbol",
    minimumFractionDigits: MINOR_DIGITS[currency],
    maximumFractionDigits: MINOR_DIGITS[currency],
  }).format(fromMinor(minor, currency));
}

export function sumMinor(values: readonly number[]): number {
  return assertMinor(values.reduce((acc, v) => acc + assertMinor(v), 0));
}

export function lineTotal(quantity: number, unitPriceMinor: number): number {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new MoneyError(`Invalid quantity: ${quantity}`);
  return assertMinor(quantity * assertMinor(unitPriceMinor));
}

/**
 * Splits a total by integer percentages so that the parts always sum to the
 * total exactly. Each part is floored; the rounding remainder goes to the last part.
 */
export function splitByPercentages(totalMinor: number, percentages: readonly number[]): number[] {
  assertMinor(totalMinor);
  if (totalMinor < 0) throw new MoneyError("Total must not be negative");
  if (percentages.length === 0) throw new MoneyError("At least one percentage is required");
  if (percentages.some((p) => !Number.isInteger(p) || p <= 0)) {
    throw new MoneyError("Percentages must be positive integers");
  }
  const sum = percentages.reduce((a, b) => a + b, 0);
  if (sum !== 100) throw new MoneyError(`Percentages must sum to 100 (got ${sum})`);

  const parts = percentages.map((p) => Math.floor((totalMinor * p) / 100));
  const allocated = parts.slice(0, -1).reduce((a, b) => a + b, 0);
  parts[parts.length - 1] = totalMinor - allocated;
  return parts;
}
