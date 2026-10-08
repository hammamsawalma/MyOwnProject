"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { CLIENT_PORTAL_PREFIX } from "@/config/routes";
import { getDb } from "@/db/client";
import { deliverables } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import { verifyOtp } from "@/lib/otp";
import { hasDownloadGrant, portalRequestContext, setDownloadGrantCookie, verifyPortalToken } from "@/lib/portal-access";
import { getSalesConfig, SALES_DISABLED_NOTICE } from "@/lib/sales";
import { requestClientOtp } from "@/lib/services/portal";
import { acceptQuote } from "@/lib/services/quotes";
import type { Locale } from "@/lib/types";
import type { ActionState } from "@/lib/ui/action-state";
import { runAction } from "@/lib/ui/errors";
import { bool, str } from "@/lib/ui/form";
import { dictionary } from "./i18n";

async function access(token: string) {
  const result = await verifyPortalToken(token);
  if (!result.ok) {
    throw new DomainError(result.reason === "rate_limited" ? "rate_limited" : "link_invalid", "Link not valid");
  }
  return result;
}

const pagePath = (token: string) => `${CLIENT_PORTAL_PREFIX}/${token}`;

/**
 * Quote acceptance form: intent "send_code" emails a one-time code; intent
 * "accept" verifies it and records the acceptance with both consents.
 */
export async function acceptQuoteAction(
  token: string,
  locale: Locale,
  quoteId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const t = dictionary(locale);
  return runAction(async (): Promise<ActionState> => {
    const link = await access(token);
    // Accepting a quote is the sale itself: refused (with the calm notice) while sales are off.
    if (!getSalesConfig().salesEnabled) return { status: "error", message: SALES_DISABLED_NOTICE[locale] };

    const termsAccepted = bool(fd, "terms");
    const waiver = bool(fd, "waiver");

    if (str(fd, "intent") === "send_code") {
      if (!termsAccepted || !waiver) return { status: "error", message: t.tickBoxesFirst };
      const sent = await requestClientOtp(getDb(), {
        projectId: link.projectId,
        purpose: "accept_quote",
        magicLinkId: link.linkId,
      });
      if (!sent.ok) throw new DomainError("rate_limited", "OTP rate limited");
      return { status: "ok", message: t.codeSent(sent.sentTo), data: { codeSent: "1" } };
    }

    await acceptQuote(getDb(), {
      projectId: link.projectId,
      quoteId,
      otpCode: str(fd, "code"),
      termsAccepted,
      startImmediatelyWaiver: waiver,
      ...(await portalRequestContext()),
    });
    revalidatePath(pagePath(token));
    return { status: "ok", message: t.accepted, data: { accepted: "1" } };
  }, locale);
}

/** Final deliverables: "send_code" emails a code; "verify" checks it and sets a 30-minute download grant. */
export async function unlockFinalsAction(
  token: string,
  locale: Locale,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const t = dictionary(locale);
  return runAction(async (): Promise<ActionState> => {
    const link = await access(token);
    const db = getDb();
    const [released] = await db
      .select({ id: deliverables.id })
      .from(deliverables)
      .where(
        and(
          eq(deliverables.projectId, link.projectId),
          eq(deliverables.kind, "final"),
          eq(deliverables.released, true),
        ),
      )
      .limit(1);
    if (!released) throw new DomainError("not_released", "No released final deliverables");
    if (await hasDownloadGrant(link.projectId)) return { status: "ok", message: t.unlocked, data: { unlocked: "1" } };

    if (str(fd, "intent") === "send_code") {
      const sent = await requestClientOtp(db, {
        projectId: link.projectId,
        purpose: "download_final",
        magicLinkId: link.linkId,
      });
      if (!sent.ok) throw new DomainError("rate_limited", "OTP rate limited");
      return { status: "ok", message: t.codeSent(sent.sentTo), data: { codeSent: "1" } };
    }

    const result = await verifyOtp(db, { projectId: link.projectId, purpose: "download_final", code: str(fd, "code") });
    if (!result.ok) {
      throw new DomainError(`otp_${result.reason}`, "Verification code rejected", {
        attemptsLeft: result.attemptsLeft,
      });
    }
    await setDownloadGrantCookie(token, link.projectId);
    revalidatePath(pagePath(token));
    return { status: "ok", message: t.unlocked, data: { unlocked: "1" } };
  }, locale);
}
