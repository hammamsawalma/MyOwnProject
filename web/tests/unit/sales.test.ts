import { afterEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/config/env";
import {
  assertSalesEnabled,
  clientPaymentPolicy,
  getSalesConfig,
  redactPaymentLink,
  SALES_ACTIONS,
  SalesDisabledError,
} from "@/lib/sales";

function withSalesEnv(value: string | undefined) {
  if (value === undefined) delete process.env.SALES_ENABLED;
  else process.env.SALES_ENABLED = value;
  resetEnvCache();
}

afterEach(() => withSalesEnv(undefined));

describe("SALES_ENABLED flag", () => {
  it("defaults to disabled", () => {
    withSalesEnv(undefined);
    expect(getSalesConfig().salesEnabled).toBe(false);
  });

  it("is enabled only by the string 'true'", () => {
    for (const off of ["false", "1", "yes", "on", "", " "]) {
      withSalesEnv(off);
      expect(getSalesConfig().salesEnabled, off).toBe(false);
    }
    withSalesEnv("true");
    expect(getSalesConfig().salesEnabled).toBe(true);
  });
});

describe("guard", () => {
  it("blocks every money action while disabled", () => {
    for (const action of SALES_ACTIONS) {
      expect(() => assertSalesEnabled(action, { salesEnabled: false })).toThrow(SalesDisabledError);
      expect(() => assertSalesEnabled(action, { salesEnabled: true })).not.toThrow();
    }
  });

  it("hides payment links and acceptance on the client page while disabled", () => {
    const off = clientPaymentPolicy({ salesEnabled: false });
    expect(off.showPaymentLinks).toBe(false);
    expect(off.canAcceptQuote).toBe(false);
    expect(off.notice?.ar).toContain("قريبًا");
    expect(off.notice?.en).toContain("soon");
    expect(clientPaymentPolicy({ salesEnabled: true })).toEqual({ showPaymentLinks: true, canAcceptQuote: true, notice: null });
  });

  it("redacts pay URLs unless sales are on and the milestone was sent", () => {
    const m = { payUrl: "https://pay.example/1", status: "sent" };
    expect(redactPaymentLink(m, { salesEnabled: false }).payUrl).toBeNull();
    expect(redactPaymentLink({ ...m, status: "draft" }, { salesEnabled: true }).payUrl).toBeNull();
    expect(redactPaymentLink(m, { salesEnabled: true }).payUrl).toBe("https://pay.example/1");
  });
});
