import { describe, expect, it } from "vitest";
import { brand, brandCssVariables, brandName, BrandSchema, whatsappUrl, type Brand } from "@/config/brand";

describe("brand config (single source)", () => {
  it("is valid", () => {
    expect(() => BrandSchema.parse(brand)).not.toThrow();
  });

  it("exposes names per locale", () => {
    expect(brandName("ar")).toBe(brand.name.ar);
    expect(brandName("en")).toBe(brand.name.en);
  });

  it("builds a wa.me link only when a number is configured", () => {
    const withNumber: Brand = { ...brand, contact: { ...brand.contact, whatsappE164: "+905551112233" } };
    expect(whatsappUrl("مرحبا", withNumber)).toBe(`https://wa.me/905551112233?text=${encodeURIComponent("مرحبا")}`);
    const without: Brand = { ...brand, contact: { ...brand.contact, whatsappE164: "" } };
    expect(whatsappUrl(undefined, without)).toBeNull();
  });

  it("maps colors to CSS variables", () => {
    const vars = brandCssVariables();
    expect(vars["--brand-primary"]).toBe(brand.colors.primary);
    expect(Object.keys(vars)).toHaveLength(7);
  });

  it("rejects invalid values", () => {
    expect(() => BrandSchema.parse({ ...brand, colors: { ...brand.colors, primary: "blue" } })).toThrow();
    expect(() => BrandSchema.parse({ ...brand, contact: { ...brand.contact, whatsappE164: "0555" } })).toThrow();
  });
});
