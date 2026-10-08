import { describe, expect, it } from "vitest";
import {
  assertCurrency,
  formatMoney,
  fromMinor,
  isCurrency,
  lineTotal,
  MoneyError,
  parseMoney,
  splitByPercentages,
  sumMinor,
  toMinor,
} from "@/lib/money";

describe("currencies", () => {
  it("supports USD and EUR only", () => {
    expect(isCurrency("USD")).toBe(true);
    expect(isCurrency("EUR")).toBe(true);
    for (const other of ["TRY", "SAR", "usd", "", null]) expect(isCurrency(other)).toBe(false);
    expect(() => assertCurrency("TRY")).toThrow(MoneyError);
  });
});

describe("minor units", () => {
  it("converts major <-> minor without float drift", () => {
    expect(toMinor(150, "USD")).toBe(15_000);
    expect(toMinor(0.1 + 0.2, "EUR")).toBe(30);
    expect(fromMinor(123_456, "USD")).toBe(1234.56);
    expect(() => toMinor(1.005, "USD")).toThrow(MoneyError);
  });

  it("parses user input, including Arabic-Indic digits", () => {
    expect(parseMoney("150", "USD")).toBe(15_000);
    expect(parseMoney("1,250.5", "USD")).toBe(125_050);
    expect(parseMoney(" 2000.00 ", "EUR")).toBe(200_000);
    expect(parseMoney("١٥٠٫٧٥", "USD")).toBe(15_075);
    for (const bad of ["", "-5", "1.234", "abc", "1e3", "1..2"]) {
      expect(() => parseMoney(bad, "USD"), bad).toThrow(MoneyError);
    }
  });

  it("rejects non-integer minor amounts", () => {
    expect(() => sumMinor([1, 2.5])).toThrow(MoneyError);
    expect(sumMinor([100, 250])).toBe(350);
    expect(lineTotal(3, 1_999)).toBe(5_997);
    expect(() => lineTotal(0, 100)).toThrow(MoneyError);
  });
});

describe("formatting", () => {
  it("formats in Arabic with Western digits and in English", () => {
    const ar = formatMoney(125_050, "USD", "ar");
    expect(ar).toContain("1,250.50");
    expect(ar).toMatch(/US\$|\$/);
    expect(formatMoney(125_050, "EUR", "en")).toBe("€1,250.50");
    expect(formatMoney(15_000, "USD", "en")).toBe("$150.00");
  });
});

describe("splitByPercentages", () => {
  it("always sums to the total exactly", () => {
    for (let total = 0; total <= 5_000; total += 7) {
      for (const split of [[100], [50, 50], [30, 40, 30], [40, 30, 30], [33, 33, 34]]) {
        const parts = splitByPercentages(total, split);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        expect(parts.every((p) => Number.isInteger(p) && p >= 0)).toBe(true);
      }
    }
  });

  it("puts the rounding remainder on the last part", () => {
    expect(splitByPercentages(1_001, [50, 50])).toEqual([500, 501]);
    expect(splitByPercentages(300_001, [30, 40, 30])).toEqual([90_000, 120_000, 90_001]);
  });

  it("validates percentages", () => {
    expect(() => splitByPercentages(100, [50, 40])).toThrow(MoneyError);
    expect(() => splitByPercentages(100, [])).toThrow(MoneyError);
    expect(() => splitByPercentages(100, [50.5, 49.5])).toThrow(MoneyError);
    expect(() => splitByPercentages(-1, [100])).toThrow(MoneyError);
  });
});
