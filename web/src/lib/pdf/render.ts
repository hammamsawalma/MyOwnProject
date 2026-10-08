import { chromium, type Browser } from "playwright-core";
import { requireEnv } from "@/config/env";

/**
 * HTML -> PDF with headless Chromium (playwright-core; browser binary from
 * CHROMIUM_PATH, never downloaded). The browser does Arabic shaping and bidi
 * correctly, which most PDF libraries get wrong (report 07 §5.5).
 */

let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({
        executablePath: requireEnv("CHROMIUM_PATH"),
        headless: true,
        args: ["--disable-dev-shm-usage", "--font-render-hinting=none"],
      })
      .catch((err: unknown) => {
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

export async function htmlToPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    // Documents are self-contained: block every network request.
    await page.route("**/*", (route) => route.abort());
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  } finally {
    await context.close();
  }
}

export async function closePdfBrowser(): Promise<void> {
  const pending = browserPromise;
  browserPromise = null;
  if (pending) await (await pending).close();
}
