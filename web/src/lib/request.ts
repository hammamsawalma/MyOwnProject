/**
 * Client IP from proxy headers. Assumes the app runs behind a trusted reverse
 * proxy (Cloudflare / nginx) that overwrites these headers; see build notes.
 */
export function clientIpFromHeaders(h: Pick<Headers, "get">): string | null {
  const candidates = [h.get("cf-connecting-ip"), h.get("x-real-ip"), h.get("x-forwarded-for")?.split(",")[0]];
  for (const value of candidates) {
    const ip = value?.trim();
    if (ip) return ip.slice(0, 64);
  }
  return null;
}
