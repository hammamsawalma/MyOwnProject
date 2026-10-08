import { env, type Env } from "@/config/env";

/**
 * Client IP, read only from the header the configured reverse proxy overwrites
 * (TRUSTED_PROXY). Any other forwarding header can be forged by the client, so
 * without a trusted proxy the IP is unknown (null) and per-IP limits are skipped.
 */
export function clientIpFromHeaders(
  h: Pick<Headers, "get">,
  trustedProxy: Env["TRUSTED_PROXY"] = env().TRUSTED_PROXY,
): string | null {
  const header = trustedProxy === "cloudflare" ? "cf-connecting-ip" : trustedProxy === "nginx" ? "x-real-ip" : null;
  const ip = header ? h.get(header)?.trim() : undefined;
  return ip ? ip.slice(0, 64) : null;
}
