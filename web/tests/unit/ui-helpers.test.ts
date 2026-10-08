import { describe, expect, it } from "vitest";
import { isolate, ltr } from "@/lib/bidi";
import { EmailNotConfiguredError } from "@/lib/email/send";
import { DomainError } from "@/lib/errors";
import { MoneyError } from "@/lib/money";
import { TransitionError } from "@/lib/project-status";
import { SalesDisabledError } from "@/lib/sales";
import { describeClientError, describeError, runAction, runClientAction } from "@/lib/ui/errors";
import { bool, int, lines, money, oneOf, optStr, str } from "@/lib/ui/form";
import { monthRange, parseDateInput, shiftMonth } from "@/lib/ui/format";
import { contentTypeFor, deniedResponse, fileResponse } from "@/lib/ui/http";
import { countryName, statusTone } from "@/lib/ui/labels";
import { clientIpFromHeaders } from "@/lib/request";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

describe("bidi helpers", () => {
  it("isolates LTR fragments and unknown-direction text", () => {
    expect(ltr("Q-2026-0001")).toBe("⁦Q-2026-0001⁩");
    expect(isolate("Lena")).toBe("⁨Lena⁩");
  });
});

describe("form readers", () => {
  const fd = form({
    name: "  سارة ",
    empty: " ",
    on: "on",
    n: "12",
    bad: "1.5",
    amount: "1,250.50",
    list: "a\n\n b \r\nc",
  });

  it("reads strings, booleans, integers, money and lines", () => {
    expect(str(fd, "name")).toBe("سارة");
    expect(optStr(fd, "empty")).toBeNull();
    expect(bool(fd, "on")).toBe(true);
    expect(bool(fd, "missing")).toBe(false);
    expect(int(fd, "n")).toBe(12);
    expect(() => int(fd, "bad")).toThrow(DomainError);
    expect(money(fd, "amount", "USD")).toBe(125_050);
    expect(lines(fd, "list")).toEqual(["a", "b", "c"]);
  });

  it("accepts only listed enum values", () => {
    expect(oneOf(form({ c: "EUR" }), "c", ["USD", "EUR"] as const)).toBe("EUR");
    expect(oneOf(form({ c: "TRY" }), "c", ["USD", "EUR"] as const, "USD")).toBe("USD");
    expect(() => oneOf(form({ c: "TRY" }), "c", ["USD", "EUR"] as const)).toThrow(DomainError);
  });
});

describe("date helpers", () => {
  it("computes month ranges and shifts across years", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-02").to).toBe("2028-02-29");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("parses date inputs at midday UTC and rejects junk", () => {
    expect(parseDateInput("2026-10-08")?.toISOString()).toBe("2026-10-08T12:00:00.000Z");
    expect(parseDateInput("08/10/2026")).toBeNull();
  });
});

describe("download responses", () => {
  it("serves PDFs inline and everything else as a sandboxed attachment", () => {
    const pdf = fileResponse(new Uint8Array([1, 2]), { fileName: "R-2026-0001.pdf" });
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(pdf.headers.get("x-robots-tag")).toContain("noindex");
    expect(pdf.headers.get("referrer-policy")).toBe("no-referrer");

    const html = fileResponse(new Uint8Array([1]), { fileName: "page.html", contentType: "text/html" });
    expect(html.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(html.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("keeps Arabic file names via RFC 5987", () => {
    const res = fileResponse(new Uint8Array([1]), { fileName: "دليل.pdf" });
    expect(res.headers.get("content-disposition")).toContain(`filename*=UTF-8''${encodeURIComponent("دليل.pdf")}`);
    expect(contentTypeFor("x.unknown")).toBe("application/octet-stream");
    expect(deniedResponse(403).status).toBe(403);
  });
});

describe("error messages", () => {
  it("maps domain errors to Arabic admin messages", () => {
    expect(describeError(new DomainError("otp_invalid_code", "x", { attemptsLeft: 3 }))).toBe(
      "الرمز غير صحيح. المحاولات المتبقية: 3.",
    );
    expect(describeError(new TransitionError("deposit_not_paid", "awaiting_deposit", "kickoff"))).toContain(
      "الدفعة المقدمة",
    );
    expect(describeError(new SalesDisabledError("record_payment"))).toContain("SALES_ENABLED=false");
    expect(describeError(new MoneyError("bad"))).toContain("المبلغ غير صالح");
    expect(describeError(new DomainError("email_failed", "x"))).toContain("Resend");
  });

  it("gives clients calm wording only: no env names, codes or permit status", () => {
    expect(describeClientError(new DomainError("otp_invalid_code", "x", { attemptsLeft: 3 }), "en")).toBe(
      "The code is incorrect. Attempts left: 3.",
    );
    expect(describeClientError(new DomainError("client_email_missing", "x"), "ar")).toBe(
      "لا يوجد بريد إلكتروني مسجّل لك. تواصل معنا لإضافته.",
    );
    expect(describeClientError(new DomainError("email_failed", "x"), "ar")).toContain("تعذّر إرسال الرمز");
    const leaks = [
      describeClientError(new SalesDisabledError("accept_quote"), "ar"),
      describeClientError(new DomainError("otp_xxx", "x"), "ar"),
      describeClientError(new EmailNotConfiguredError(), "ar"),
      describeClientError(new TransitionError("not_allowed", "lead", "closed"), "ar"),
    ];
    for (const message of leaks) {
      expect(message).not.toMatch(/SALES_ENABLED|RESEND|التصريح|otp_|سجل الخادم/);
    }
    const original = console.error;
    console.error = () => {};
    try {
      expect(describeClientError(new Error("db down"), "en")).toBe(
        "We could not complete this right now. Please try again shortly or contact us.",
      );
    } finally {
      console.error = original;
    }
  });

  it("runAction / runClientAction turn thrown errors into an error state", async () => {
    await expect(runAction(async () => undefined)).resolves.toEqual({ status: "ok" });
    await expect(
      runClientAction(async () => {
        throw new DomainError("quote_expired", "x");
      }, "en"),
    ).resolves.toEqual({ status: "error", message: "This quote has expired. Contact us to renew it." });
  });
});

describe("labels", () => {
  it("names countries and tones statuses", () => {
    expect(countryName("SA")).toContain("السعودية");
    expect(countryName("DE", "en")).toBe("Germany");
    expect(countryName(null)).toBe("—");
    expect(statusTone("disputed")).toBe("danger");
    expect(statusTone("delivered")).toBe("success");
  });
});

describe("client IP", () => {
  const headers = new Headers({
    "cf-connecting-ip": "203.0.113.1",
    "x-real-ip": "203.0.113.2",
    "x-forwarded-for": "203.0.113.3, 10.0.0.1",
  });

  it("reads only the header of the configured trusted proxy", () => {
    expect(clientIpFromHeaders(headers, "cloudflare")).toBe("203.0.113.1");
    expect(clientIpFromHeaders(headers, "nginx")).toBe("203.0.113.2");
    // Without a trusted proxy every forwarding header may be forged: IP unknown.
    expect(clientIpFromHeaders(headers, "none")).toBeNull();
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "203.0.113.2" }), "cloudflare")).toBeNull();
  });
});
