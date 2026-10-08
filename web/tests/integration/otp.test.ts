import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { policy } from "@/config/policy";
import { otpCodes } from "@/db/schema";
import { issueOtp, verifyOtp } from "@/lib/otp";
import { requestClientOtp } from "@/lib/services/portal";
import { createClient, createProject } from "@/lib/services/projects";
import { latestOtpFromOutbox, openTestDb, resetDatabase } from "./helpers";

const handle = openTestDb();
const { db } = handle;
let projectId: string;
const purpose = "accept_quote" as const;

beforeEach(async () => {
  await resetDatabase(handle);
  const client = await createClient(db, { name: "Client", email: "client@example.com", language: "en" });
  projectId = (await createProject(db, { clientId: client.id, title: "Project" })).id;
});
afterAll(() => handle.close());

async function issue(now?: Date) {
  const result = await issueOtp(db, { projectId, purpose, email: "client@example.com", now });
  if (!result.ok) throw new Error("issue failed");
  return result;
}

describe("OTP codes", () => {
  it("verifies once, then cannot be reused", async () => {
    const { code, otpId } = await issue();
    const [row] = await db.select().from(otpCodes).where(eq(otpCodes.id, otpId));
    expect(row?.codeHash).not.toContain(code);
    expect(await verifyOtp(db, { projectId, purpose, code })).toEqual({ ok: true, otpId });
    expect(await verifyOtp(db, { projectId, purpose, code })).toMatchObject({ ok: false, reason: "no_active_code" });
  });

  it("is scoped to the project and purpose", async () => {
    const { code } = await issue();
    expect(await verifyOtp(db, { projectId, purpose: "download_final", code })).toMatchObject({
      ok: false,
      reason: "no_active_code",
    });
  });

  it("locks after 5 wrong attempts, even for the right code", async () => {
    const { code } = await issue();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 1; i <= policy.otp.maxAttempts; i++) {
      expect(await verifyOtp(db, { projectId, purpose, code: wrong })).toEqual({
        ok: false,
        reason: "invalid_code",
        attemptsLeft: policy.otp.maxAttempts - i,
      });
    }
    expect(await verifyOtp(db, { projectId, purpose, code })).toMatchObject({ ok: false, reason: "too_many_attempts" });
  });

  it("never allows more than 5 attempts under parallel guessing", async () => {
    const { otpId, code } = await issue();
    const wrong = code === "000000" ? "111111" : "000000";
    await Promise.all(Array.from({ length: 12 }, () => verifyOtp(db, { projectId, purpose, code: wrong })));
    const [row] = await db.select().from(otpCodes).where(eq(otpCodes.id, otpId));
    expect(row?.attempts).toBe(policy.otp.maxAttempts);
  });

  it("expires after 10 minutes", async () => {
    const now = new Date();
    const { code } = await issue(now);
    const later = new Date(now.getTime() + (policy.otp.ttlMinutes * 60 + 1) * 1000);
    expect(await verifyOtp(db, { projectId, purpose, code, now: later })).toMatchObject({ ok: false, reason: "expired" });
  });

  it("invalidates the previous code when a new one is issued", async () => {
    const first = await issue();
    const second = await issue();
    if (first.code !== second.code) {
      expect(await verifyOtp(db, { projectId, purpose, code: first.code })).toMatchObject({ ok: false });
    }
    expect(await verifyOtp(db, { projectId, purpose, code: second.code })).toMatchObject({ ok: true });
  });

  it("limits how many codes can be issued per hour", async () => {
    for (let i = 0; i < policy.otp.maxIssuesPerHour; i++) await issue();
    const blocked = await issueOtp(db, { projectId, purpose, email: "client@example.com" });
    expect(blocked).toMatchObject({ ok: false, reason: "rate_limited" });
  });

  it("emails the code to the client (dev outbox) without returning it", async () => {
    const result = await requestClientOtp(db, { projectId, purpose });
    expect(result).toMatchObject({ ok: true, sentTo: "cl****@example.com" });
    expect(JSON.stringify(result)).not.toMatch(/\b\d{6}\b/);
    const code = await latestOtpFromOutbox(handle);
    expect(await verifyOtp(db, { projectId, purpose, code })).toMatchObject({ ok: true });
  });
});
