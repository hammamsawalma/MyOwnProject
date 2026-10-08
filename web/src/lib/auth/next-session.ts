import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { isProduction } from "@/config/env";
import { ADMIN_LOGIN_PATH } from "@/config/routes";
import { getDb } from "@/db/client";
import { clientIpFromHeaders } from "@/lib/request";
import { getAdminSession, revokeAdminSession } from "./admin";

/** Next.js glue for the admin session cookie (httpOnly, Secure in production, SameSite=Lax). */

export function adminCookieName(): string {
  // The __Host- prefix requires Secure, which browsers reject on plain http://localhost.
  return isProduction() ? "__Host-admin_session" : "admin_session";
}

export async function setAdminSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(adminCookieName(), token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function getCurrentAdminSession() {
  const store = await cookies();
  const token = store.get(adminCookieName())?.value;
  if (!token) return null;
  return getAdminSession(getDb(), token);
}

/** Use at the top of every admin page, server action and route handler. */
export async function requireAdmin() {
  const session = await getCurrentAdminSession();
  if (!session) redirect(ADMIN_LOGIN_PATH);
  return session;
}

export async function logoutAdmin(): Promise<void> {
  const store = await cookies();
  const token = store.get(adminCookieName())?.value;
  if (token) await revokeAdminSession(getDb(), token);
  store.delete(adminCookieName());
}

export async function requestContext(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  return { ip: clientIpFromHeaders(h), userAgent: h.get("user-agent") };
}
