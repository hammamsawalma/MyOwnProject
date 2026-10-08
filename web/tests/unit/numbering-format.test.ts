import { describe, expect, it } from "vitest";
import { formatDocumentNumber, NUMBER_SERIES, parseDocumentNumber, yearInTimeZone } from "@/lib/numbering";

describe("document number format", () => {
  it("formats Q/R/CN/P-YYYY-NNNN", () => {
    expect(formatDocumentNumber(NUMBER_SERIES.quote, 2026, 1)).toBe("Q-2026-0001");
    expect(formatDocumentNumber(NUMBER_SERIES.receipt, 2026, 42)).toBe("R-2026-0042");
    expect(formatDocumentNumber(NUMBER_SERIES.creditNote, 2027, 9_999)).toBe("CN-2027-9999");
    expect(formatDocumentNumber(NUMBER_SERIES.project, 2026, 12_345)).toBe("P-2026-12345");
    expect(() => formatDocumentNumber("Q", 2026, 0)).toThrow();
  });

  it("parses known series only", () => {
    expect(parseDocumentNumber("R-2026-0042")).toEqual({ series: "R", year: 2026, number: 42 });
    expect(parseDocumentNumber("CN-2027-0001")).toEqual({ series: "CN", year: 2027, number: 1 });
    expect(parseDocumentNumber("X-2026-0001")).toBeNull();
    expect(parseDocumentNumber("R-26-1")).toBeNull();
  });

  it("uses the business time zone for the year", () => {
    const newYearsEveUtc = new Date("2026-12-31T22:30:00Z");
    expect(yearInTimeZone(newYearsEveUtc, "Europe/Istanbul")).toBe(2027);
    expect(yearInTimeZone(newYearsEveUtc, "UTC")).toBe(2026);
  });
});
