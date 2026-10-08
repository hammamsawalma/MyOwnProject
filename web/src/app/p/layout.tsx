import type { Metadata } from "next";
import type { ReactNode } from "react";

// Client portal: never indexed (headers in next.config.ts add X-Robots-Tag and Referrer-Policy too).
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function PortalLayout({ children }: { children: ReactNode }) {
  return children;
}
