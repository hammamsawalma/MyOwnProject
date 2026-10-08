import "server-only";
import { cookies, headers } from "next/headers";
import { isProduction } from "@/config/env";
import { policy } from "@/config/policy";
import { CLIENT_PORTAL_PREFIX } from "@/config/routes";
import { getDb } from "@/db/client";
import { verifyMagicLink, type VerifyMagicLinkResult } from "@/lib/magic-links";
import { createDownloadGrant, verifyDownloadGrant } from "@/lib/otp";
import { clientIpFromHeaders } from "@/lib/request";

/**
 * Next.js glue for the client portal: every page render, action and download
 * re-verifies the magic token (expiry, revocation, rate limit, usage count).
 */

export async function verifyPortalToken(token: string): Promise<VerifyMagicLinkResult> {
  const ip = clientIpFromHeaders(await headers());
  return verifyMagicLink(getDb(), token, { ip });
}

export async function portalRequestContext(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  return { ip: clientIpFromHeaders(h), userAgent: h.get("user-agent") };
}

const GRANT_COOKIE = "portal_dl";

/** After a valid download OTP: a short-lived signed grant, scoped to this link's path. */
export async function setDownloadGrantCookie(token: string, projectId: string): Promise<void> {
  const store = await cookies();
  store.set(GRANT_COOKIE, createDownloadGrant(projectId), {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "strict",
    path: `${CLIENT_PORTAL_PREFIX}/${token}`,
    maxAge: policy.downloadGrantMinutes * 60,
  });
}

export async function hasDownloadGrant(projectId: string): Promise<boolean> {
  const grant = (await cookies()).get(GRANT_COOKIE)?.value;
  return grant ? verifyDownloadGrant(grant, projectId) : false;
}
