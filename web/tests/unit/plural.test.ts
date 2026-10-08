import { describe, expect, it } from "vitest";
import { AR_NOUNS, arCount, enCount } from "@/lib/plural";

describe("Arabic number-noun agreement", () => {
  it("follows the Arabic plural categories", () => {
    expect(arCount(1, AR_NOUNS.day)).toBe("يوم واحد");
    expect(arCount(2, AR_NOUNS.day)).toBe("يومان");
    expect(arCount(2, AR_NOUNS.day, { oblique: true })).toBe("يومين");
    expect(arCount(7, AR_NOUNS.day)).toBe("7 أيام");
    expect(arCount(30, AR_NOUNS.day)).toBe("30 يومًا");
    expect(arCount(100, AR_NOUNS.day)).toBe("100 يوم");
    expect(arCount(3, AR_NOUNS.project)).toBe("3 مشاريع");
    expect(arCount(3, AR_NOUNS.client)).toBe("3 عملاء");
    expect(arCount(12, AR_NOUNS.entry)).toBe("12 قيدًا");
    expect(arCount(10, AR_NOUNS.minute, { oblique: true })).toBe("10 دقائق");
  });

  it("pluralises English", () => {
    expect(enCount(1, "day")).toBe("1 day");
    expect(enCount(10, "minute")).toBe("10 minutes");
  });
});
