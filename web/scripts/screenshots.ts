/**
 * Captures UI screenshots against a running dev server with seed data, and
 * renders the latest quote and receipt PDFs to PNG (needs `pdftoppm`).
 *
 *   pnpm db:reset && pnpm dev            # in another terminal
 *   ADMIN_PASSWORD=... pnpm screenshots  # default output: ../docs/build/screenshots
 *
 * Development only: it creates tracking links directly in the database.
 */
import "./load-env";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { chromium, type Page } from "playwright-core";
import { createDb } from "@/db/client";
import { documents, projects } from "@/db/schema";
import { createMagicLink, revokeMagicLink } from "@/lib/magic-links";
import { closePdfBrowser } from "@/lib/pdf/render";
import { getDocumentPdf } from "@/lib/services/documents";

const BASE = (process.env.SCREENSHOT_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const OUT = path.resolve(process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? "../docs/build/screenshots");
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 400, height: 860 };

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function shot(page: Page, url: string, file: string, viewport = DESKTOP) {
  await page.setViewportSize(viewport);
  await page.goto(`${BASE}${url}`);
  await page.waitForLoadState("networkidle");
  // Hide the Next.js dev-tools badge.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
  console.log(`  ${file}`);
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Development only");
  const adminEmail = required("ADMIN_EMAIL");
  const adminPassword = required("ADMIN_PASSWORD");
  const { db, close } = createDb(required("DATABASE_URL"), { max: 2 });
  mkdirSync(OUT, { recursive: true });

  try {
    const byRef = async (ref: string) => {
      const [row] = await db.select().from(projects).where(eq(projects.ref, ref));
      if (!row) throw new Error(`Project ${ref} not found: run pnpm db:reset first`);
      return row;
    };
    const done = await byRef("P-2026-0001");
    const quoted = await byRef("P-2026-0002");
    const tokenOf = async (projectId: string) =>
      new URL((await createMagicLink(db, { projectId })).url).pathname.split("/").pop()!;
    const doneToken = await tokenOf(done.id);
    const quotedToken = await tokenOf(quoted.id);
    const revoked = await createMagicLink(db, { projectId: quoted.id });
    await revokeMagicLink(db, revoked.id);

    const browser = await chromium.launch({ executablePath: required("CHROMIUM_PATH") });
    const page = await browser.newPage({ viewport: DESKTOP });

    console.log("Public and client pages:");
    await shot(page, "/", "home.png");
    await shot(page, `/p/${quotedToken}`, "client-ar-desktop.png");
    await shot(page, `/p/${quotedToken}`, "client-ar-phone.png", PHONE);
    await shot(page, `/p/${quotedToken}?lang=en`, "client-en-desktop.png");
    await shot(page, `/p/${quotedToken}?lang=en`, "client-en-phone.png", PHONE);
    await shot(page, `/p/${doneToken}`, "client-ar-delivered-phone.png", PHONE);
    await shot(page, `/p/${doneToken}?lang=en`, "client-en-delivered-desktop.png");
    await shot(page, `/p/${new URL(revoked.url).pathname.split("/").pop()}`, "client-revoked-link.png", PHONE);

    console.log("Admin pages:");
    await shot(page, "/admin/login", "admin-login.png");
    await page.fill("#email", adminEmail);
    await page.fill("#password", adminPassword);
    await Promise.all([page.waitForURL(`${BASE}/admin`), page.getByRole("button", { name: "دخول" }).click()]);
    await shot(page, "/admin", "admin-today.png");
    await shot(page, "/admin/projects?status=all", "admin-projects.png");
    await shot(page, `/admin/projects/${quoted.id}`, "admin-project-quote-sent.png");
    await shot(page, `/admin/projects/${done.id}`, "admin-project-warranty.png");
    await shot(page, `/admin/projects/${quoted.id}`, "admin-project-phone.png", PHONE);
    await shot(page, `/admin/projects/${quoted.id}/quotes/new`, "admin-quote-builder.png");
    await shot(page, "/admin/clients", "admin-clients.png");
    await shot(page, "/admin/costs", "admin-costs.png");
    await shot(page, "/admin/outbox", "admin-outbox.png");
    await shot(page, "/admin/settings", "admin-settings.png");
    await browser.close();

    console.log("PDFs:");
    for (const [type, name] of [
      ["quote_pdf", "pdf-quote"],
      ["receipt", "pdf-receipt"],
    ] as const) {
      const [doc] = await db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.type, type))
        .orderBy(desc(documents.issuedAt))
        .limit(1);
      if (!doc) continue;
      const { ref, pdf } = await getDocumentPdf(db, doc.id);
      const file = path.join(tmpdir(), `${ref}.pdf`);
      writeFileSync(file, pdf);
      try {
        execFileSync("pdftoppm", ["-r", "110", "-png", file, path.join(OUT, `${name}-${ref}`)]);
        console.log(`  ${name}-${ref}-*.png`);
      } catch {
        console.warn("  pdftoppm not found: install poppler-utils to render PDFs to PNG");
      }
    }
    await closePdfBrowser();
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
