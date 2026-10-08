import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "./globals.css";
import { brand, brandCssVariables } from "@/config/brand";

export const metadata: Metadata = {
  title: { default: brand.name.ar, template: `%s | ${brand.name.ar}` },
  description: brand.tagline.ar,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" style={brandCssVariables() as CSSProperties}>
      <body className="min-h-screen bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
