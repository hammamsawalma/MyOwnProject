import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/crypto";
import { generateMagicToken, hashMagicToken, isWellFormedMagicToken, magicLinkState, magicLinkUrl } from "@/lib/magic-links";
import {
  createDownloadGrant,
  generateOtpCode,
  hashOtpCode,
  normalizeOtpInput,
  otpState,
  verifyDownloadGrant,
} from "@/lib/otp";

describe("magic link tokens", () => {
  it("are 256-bit base64url tokens stored only as SHA-256", () => {
    const { token, tokenHash } = generateMagicToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(tokenHash).toBe(sha256Hex(token));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashMagicToken(token)).toBe(tokenHash);
  });

  it("never repeat", () => {
    const seen = new Set(Array.from({ length: 2_000 }, () => generateMagicToken().token));
    expect(seen.size).toBe(2_000);
  });

  it("validates format before any lookup", () => {
    expect(isWellFormedMagicToken(generateMagicToken().token)).toBe(true);
    for (const bad of ["", "short", "x".repeat(44), `${"a".repeat(42)}!`, "../../etc/passwd"]) {
      expect(isWellFormedMagicToken(bad)).toBe(false);
    }
  });

  it("computes state from expiry and revocation", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const future = new Date("2027-01-01T00:00:00Z");
    expect(magicLinkState({ expiresAt: future, revokedAt: null }, now)).toBe("active");
    expect(magicLinkState({ expiresAt: now, revokedAt: null }, now)).toBe("expired");
    expect(magicLinkState({ expiresAt: future, revokedAt: now }, now)).toBe("revoked");
  });

  it("builds the portal URL", () => {
    expect(magicLinkUrl("abc", "https://studio.example/")).toBe("https://studio.example/p/abc");
  });
});

describe("one-time codes", () => {
  it("are 6 digits", () => {
    for (let i = 0; i < 200; i++) expect(generateOtpCode()).toMatch(/^\d{6}$/);
  });

  it("are hashed with a secret and bound to the code id", () => {
    const a = hashOtpCode("secret-1", "id-1", "123456");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOtpCode("secret-1", "id-1", "123456")).toBe(a);
    expect(hashOtpCode("secret-1", "id-2", "123456")).not.toBe(a);
    expect(hashOtpCode("secret-2", "id-1", "123456")).not.toBe(a);
    expect(a).not.toBe(sha256Hex("123456"));
  });

  it("accepts Arabic-Indic digits and spaces", () => {
    expect(normalizeOtpInput("١٢٣ ٤٥٦")).toBe("123456");
    expect(normalizeOtpInput(" 12 34 56 ")).toBe("123456");
  });

  it("derives the state of a code", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const base = {
      expiresAt: new Date(now.getTime() + 60_000),
      consumedAt: null,
      invalidatedAt: null,
      attempts: 0,
      maxAttempts: 5,
    };
    expect(otpState(base, now)).toBe("active");
    expect(otpState({ ...base, attempts: 5 }, now)).toBe("locked");
    expect(otpState({ ...base, consumedAt: now }, now)).toBe("consumed");
    expect(otpState({ ...base, invalidatedAt: now }, now)).toBe("invalidated");
    expect(otpState({ ...base, expiresAt: now }, now)).toBe("expired");
  });
});

describe("download grants", () => {
  const secret = "grant-secret-grant-secret-grant-secret";
  const now = new Date("2026-10-08T12:00:00Z");

  it("are valid for the same project until they expire", () => {
    const grant = createDownloadGrant("project-1", { now, secret });
    expect(verifyDownloadGrant(grant, "project-1", { now, secret })).toBe(true);
    expect(verifyDownloadGrant(grant, "project-2", { now, secret })).toBe(false);
    expect(verifyDownloadGrant(grant, "project-1", { now: new Date(now.getTime() + 31 * 60_000), secret })).toBe(false);
  });

  it("reject tampering", () => {
    const grant = createDownloadGrant("project-1", { now, secret });
    const [p, exp, sig] = grant.split(".");
    expect(verifyDownloadGrant(`${p}.${Number(exp) + 999_999}.${sig}`, "project-1", { now, secret })).toBe(false);
    expect(verifyDownloadGrant(grant, "project-1", { now, secret: "other-secret-other-secret-other" })).toBe(false);
    expect(verifyDownloadGrant("garbage", "project-1", { now, secret })).toBe(false);
  });
});
