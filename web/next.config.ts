import type { NextConfig } from "next";
import { ADMIN_PREFIX, CLIENT_PORTAL_PREFIX } from "./src/config/routes";

const baseSecurityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// Client portal and admin pages: never indexed, never leak the URL (magic token) via Referer.
const privatePageHeaders = [
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cache-Control", value: "private, no-store" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Do not let `next dev` write AGENTS.md/CLAUDE.md into the repo (agent docs live in README).
  agentRules: false,
  serverExternalPackages: ["playwright-core", "@node-rs/argon2"],
  experimental: {
    // Deliverable and payment-evidence uploads go through admin server actions.
    // Larger files should be shared as external links.
    serverActions: { bodySizeLimit: "25mb" },
  },
  async headers() {
    return [
      { source: "/:path*", headers: baseSecurityHeaders },
      { source: CLIENT_PORTAL_PREFIX, headers: privatePageHeaders },
      { source: `${CLIENT_PORTAL_PREFIX}/:path*`, headers: privatePageHeaders },
      { source: ADMIN_PREFIX, headers: privatePageHeaders },
      { source: `${ADMIN_PREFIX}/:path*`, headers: privatePageHeaders },
    ];
  },
};

export default nextConfig;
