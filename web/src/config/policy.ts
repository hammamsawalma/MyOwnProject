/**
 * Operational defaults taken from research report 09 (SOP §6.1, §4.1) and
 * report 07 (§5.7). These are proposals, not final decisions; change here.
 */
export const policy = {
  /** Version label of the terms the client accepts with a quote. Bump on every terms change. */
  termsVersion: "draft-2026-10",
  /** Quote validity when sent (SOP: 7 days). */
  quoteValidityDays: 7,
  /** Quote acceptance requires the explicit "start immediately / waive EU withdrawal" checkbox. */
  requireStartImmediatelyWaiver: true,
  otp: {
    length: 6,
    ttlMinutes: 10,
    maxAttempts: 5,
    /** Max codes issued per project+purpose per hour. */
    maxIssuesPerHour: 5,
  },
  magicLink: {
    /** Verification attempts allowed per IP in the window. */
    maxVerificationsPerWindow: 120,
    windowSeconds: 600,
  },
  adminLogin: {
    maxFailuresPerWindow: 5,
    windowSeconds: 900,
    sessionTtlDays: 7,
  },
  /** Download grant lifetime after a successful OTP for final deliverables. */
  downloadGrantMinutes: 30,
} as const;
