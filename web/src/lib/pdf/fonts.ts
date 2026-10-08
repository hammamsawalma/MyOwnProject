import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * IBM Plex Sans Arabic (SIL OFL 1.1, via @fontsource) embedded as data URIs so
 * Chromium renders PDFs offline with correct Arabic shaping. Arabic + Latin
 * subsets cover mixed text such as "عرض سعر Q-2026-0001 بقيمة $1,250.00".
 */

export const PDF_FONT_FAMILY = "IBM Plex Sans Arabic";

const SUBSETS = ["arabic", "latin", "latin-ext"] as const;
const WEIGHTS = [400, 700] as const;

function fontDir(): string {
  return path.join(process.cwd(), "node_modules", "@fontsource", "ibm-plex-sans-arabic");
}

let cachedCss: string | undefined;

export function embeddedFontCss(): string {
  if (cachedCss) return cachedCss;
  const dir = fontDir();
  const ranges = JSON.parse(readFileSync(path.join(dir, "unicode.json"), "utf8")) as Record<string, string>;
  const faces: string[] = [];
  for (const subset of SUBSETS) {
    for (const weight of WEIGHTS) {
      const file = path.join(dir, "files", `ibm-plex-sans-arabic-${subset}-${weight}-normal.woff2`);
      const data = readFileSync(file).toString("base64");
      faces.push(
        `@font-face{font-family:'${PDF_FONT_FAMILY}';font-style:normal;font-weight:${weight};` +
          `src:url(data:font/woff2;base64,${data}) format('woff2');unicode-range:${ranges[subset]};}`,
      );
    }
  }
  cachedCss = faces.join("\n");
  return cachedCss;
}
