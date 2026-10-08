import { ImageResponse } from "next/og";
import { brand } from "@/config/brand";

// Favicon generated from the brand config, so it changes with the rebrand.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: brand.colors.primary,
        color: brand.colors.primaryForeground,
        fontSize: 20,
        fontWeight: 700,
        borderRadius: 7,
      }}
    >
      {brand.logoText.en.charAt(0)}
    </div>,
    size,
  );
}
