/**
 * Browser end-to-end check of the critical flows against a running dev server.
 * It reads the server's sales mode from the admin settings page and runs:
 *
 *  - sales OFF: client -> project -> quote builder (30/40/30) -> issue PDF ->
 *    magic link -> client page (no pay/accept, notice, English) -> revoke.
 *  - sales ON (needs a fresh seed: P-2026-0002 at quote_sent): OTP acceptance
 *    with consents -> pay link -> manual payment + evidence + receipt ->
 *    final file released after the last payment -> OTP-gated download.
 *
 *   pnpm db:reset && pnpm dev                       # sales off (default)
 *   pnpm db:reset && SALES_ENABLED=true pnpm dev    # sales on (local only)
 *   ADMIN_PASSWORD=... pnpm e2e
 *
 * The client browser sends X-Real-IP; start the server with TRUSTED_PROXY=nginx
 * (and run the script with the same value) to check that the IP is recorded.
 */
import "./load-env";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, asc, desc, eq } from "drizzle-orm";
import { chromium, type Browser, type Page } from "playwright-core";
import { createDb } from "@/db/client";
import { consents, deliverables, documents, emailOutbox, magicLinks, paymentMilestones, projects } from "@/db/schema";
import { hashMagicToken } from "@/lib/magic-links";

const BASE = (process.env.E2E_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
type Db = ReturnType<typeof createDb>["db"];

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const ok = (message: string) => console.log(`✓ ${message}`);

const CLIENT_IP = "203.0.113.50";
const clientContext = { viewport: { width: 400, height: 860 }, extraHTTPHeaders: { "x-real-ip": CLIENT_IP } };
/** The IP the server should record: only behind a trusted proxy (see lib/request.ts). */
const expectedIp = process.env.TRUSTED_PROXY === "nginx" ? CLIENT_IP : null;

async function waitFor(check: () => Promise<boolean>, label: string, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function latestOtp(db: Db): Promise<string> {
  const [mail] = await db.select().from(emailOutbox).orderBy(desc(emailOutbox.createdAt)).limit(1);
  const code = mail?.textBody.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error("No OTP in the dev outbox (is RESEND_API_KEY empty?)");
  return code;
}

async function login(browser: Browser): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("dialog", (d) => void d.accept());
  await page.goto(`${BASE}/admin/login`);
  await page.fill("#email", required("ADMIN_EMAIL"));
  await page.fill("#password", required("ADMIN_PASSWORD"));
  await Promise.all([page.waitForURL(`${BASE}/admin`), page.getByRole("button", { name: "دخول" }).click()]);
  return page;
}

async function newTrackingLink(admin: Page): Promise<string> {
  await admin.getByRole("button", { name: "إنشاء رابط جديد" }).click();
  const input = admin.getByLabel("رابط التتبع");
  await input.waitFor();
  return input.inputValue();
}

async function salesOffFlow(db: Db, browser: Browser, admin: Page) {
  const suffix = Date.now().toString(36);
  await admin.goto(`${BASE}/admin/clients/new`);
  await admin.fill("#name", `عميل اختبار ${suffix}`);
  await admin.fill("#email", `e2e.${suffix}@example.com`);
  await Promise.all([
    admin.waitForURL(/\/admin\/clients\/[0-9a-f-]{36}$/),
    admin.getByRole("button", { name: "إضافة العميل" }).click(),
  ]);
  await admin.fill("#title", "مشروع اختبار الواجهة");
  await Promise.all([
    admin.waitForURL(/\/admin\/projects\/[0-9a-f-]{36}$/),
    admin.getByRole("button", { name: "إنشاء المشروع" }).click(),
  ]);
  const projectId = admin.url().split("/").pop()!;
  const status = async () => (await db.select().from(projects).where(eq(projects.id, projectId)))[0]?.status;
  ok("client and project created");

  await admin.goto(`${BASE}/admin/projects/${projectId}/quotes/new`);
  await admin.locator('input[id^="line-d-"]').nth(0).fill("تحليل وتصميم");
  await admin.locator('input[id^="line-p-"]').nth(0).fill("1000");
  await admin.getByRole("button", { name: "+ إضافة بند" }).click();
  await admin.locator('input[id^="line-d-"]').nth(1).fill("تنفيذ وتسليم");
  await admin.locator('input[id^="line-p-"]').nth(1).fill("1,500");
  await admin.getByText("دفعة مرحلية").first().waitFor();
  await Promise.all([admin.waitForURL(/#quotes$/), admin.getByRole("button", { name: "حفظ المسودة" }).click()]);
  assert.equal(await status(), "quote_draft");
  await admin.getByRole("button", { name: "إصدار وإرسال (PDF)" }).click();
  await admin.getByText(/صدر عرض السعر Q-\d{4}-\d{4}/).waitFor({ timeout: 30_000 });
  assert.equal(await status(), "quote_sent");
  const pdfHref = await admin.locator('a[href^="/admin/files/documents/"]').first().getAttribute("href");
  const pdf = await admin.request.get(`${BASE}${pdfHref}`);
  assert.equal(pdf.headers()["content-type"], "application/pdf");
  ok("quote drafted with the 30/40/30 default, issued with a Q number and a PDF");

  const url = await newTrackingLink(admin);
  const token = url.split("/").pop()!;
  const [stored] = await db
    .select()
    .from(magicLinks)
    .where(eq(magicLinks.tokenHash, hashMagicToken(token)));
  assert.ok(stored, "only the token hash is stored");

  const client = await (await browser.newContext(clientContext)).newPage();
  const response = await client.goto(url);
  assert.equal(response?.headers()["x-robots-tag"], "noindex, nofollow, noarchive");
  assert.equal(response?.headers()["referrer-policy"], "no-referrer");
  await client.getByText(/قبول العرض والدفع سيُفتحان قريبًا/).first().waitFor();
  await client.getByText("للاطلاع", { exact: true }).first().waitFor();
  assert.equal(await client.getByText("بانتظار موافقتك").count(), 0);
  assert.equal(await client.getByText("الدفع الإلكتروني سيُفتح قريبًا").count(), 0, "one notice, not two");
  assert.equal(await client.getByText("ادفع الآن").count(), 0);
  assert.equal(await client.getByRole("button", { name: "أرسل رمز التحقق إلى بريدي" }).count(), 0);
  assert.ok((await client.locator('li[aria-current="step"]').innerText()).includes("عرض السعر"));
  await client.getByText("English").click();
  await client.getByText(/Accepting the quote and paying will open soon/).first().waitFor();
  ok("client page: sales-off notice, no pay or accept, stage «عرض السعر», English toggle, private headers");

  await admin.reload();
  await admin.getByRole("button", { name: "إلغاء", exact: true }).first().click();
  await admin.getByText("أُلغي الرابط.").waitFor();
  await client.goto(url);
  await client.getByText("هذا الرابط لم يعد فعّالًا").waitFor();
  ok("revoked link shows the friendly page");

  const receipts = await db
    .select()
    .from(documents)
    .where(and(eq(documents.projectId, projectId), eq(documents.type, "receipt")));
  assert.equal(receipts.length, 0);
}

async function salesOnFlow(db: Db, browser: Browser, admin: Page) {
  const [project] = await db.select().from(projects).where(eq(projects.ref, "P-2026-0002"));
  if (project?.status !== "quote_sent") throw new Error("Sales-on flow needs a fresh seed (pnpm db:reset)");
  const status = async () => (await db.select().from(projects).where(eq(projects.id, project.id)))[0]?.status;
  const milestones = () =>
    db
      .select()
      .from(paymentMilestones)
      .where(eq(paymentMilestones.projectId, project.id))
      .orderBy(asc(paymentMilestones.sequence));

  await admin.goto(`${BASE}/admin/projects/${project.id}`);
  const url = await newTrackingLink(admin);
  const client = await (await browser.newContext(clientContext)).newPage();
  await client.goto(`${url}?lang=en`);
  await client.getByLabel(/I have read and agree to the terms/).check();
  await client.getByLabel(/I ask you to start work immediately/).check();
  await client.getByRole("button", { name: "Email me a verification code" }).click();
  await client.getByText(/We sent a code to/).waitFor();
  await client.fill("#otp-code", await latestOtp(db));
  await client.getByRole("button", { name: "Confirm acceptance" }).click();
  await client.getByText(/You accepted this quote on/).waitFor();
  assert.equal(await status(), "awaiting_deposit");
  const recorded = await db.select().from(consents).where(eq(consents.projectId, project.id));
  assert.deepEqual(recorded.map((c) => c.kind).sort(), ["eu_withdrawal_waiver", "terms"]);
  assert.ok(recorded.every((c) => c.granted && c.ip === expectedIp && c.userAgent && c.version));
  ok("quote accepted with OTP; terms + waiver consents recorded with version, IP and user agent");

  await admin.reload();
  const row = (label: string) => admin.locator("#payments li", { hasText: label }).first();
  await row("الدفعة المقدمة").getByText("إرسال رابط الدفع").click();
  await row("الدفعة المقدمة").locator('input[name="payUrl"]').fill("https://pay.example.com/request/1");
  await row("الدفعة المقدمة").getByRole("button", { name: "إرسال للعميل" }).click();
  await admin.getByText("أُرسل طلب الدفع ويظهر الرابط للعميل.").waitFor();
  await client.reload();
  assert.equal(
    await client.getByRole("link", { name: "Pay now", exact: true }).getAttribute("href"),
    "https://pay.example.com/request/1",
  );
  ok("payment link reaches the client");

  const dir = mkdtempSync(path.join(tmpdir(), "e2e-"));
  writeFileSync(path.join(dir, "evidence.pdf"), "%PDF-1.4\n% e2e evidence\n");
  writeFileSync(path.join(dir, "final.txt"), "final deliverable content\n");
  await row("الدفعة المقدمة").getByText("تسجيل الدفع يدويًا + إيصال").click();
  await row("الدفعة المقدمة").locator('input[name="providerRef"]').fill("PO-777");
  await row("الدفعة المقدمة").locator('input[name="evidence"]').setInputFiles(path.join(dir, "evidence.pdf"));
  await row("الدفعة المقدمة").getByRole("button", { name: "تم الدفع: أصدر الإيصال" }).click();
  await admin.getByText(/سُجّلت الدفعة وصدر الإيصال R-\d{4}-\d{4}/).waitFor({ timeout: 30_000 });
  assert.equal(await status(), "kickoff");
  ok("deposit recorded with evidence; receipt issued; project moved to kickoff");

  await admin.getByText("إضافة تسليم").click();
  await admin.selectOption("#dl-kind", "final");
  await admin.fill("#dl-title", "الملفات النهائية");
  await admin.locator("#dl-file").setInputFiles(path.join(dir, "final.txt"));
  await admin.getByRole("button", { name: "إضافة", exact: true }).click();
  await admin.getByText("أُضيف التسليم النهائي (يُفتح بعد سداد كل الدفعات).").waitFor();

  await row("دفعة مرحلية").getByText("تسجيل الدفع يدويًا + إيصال").click();
  await row("دفعة مرحلية").getByRole("button", { name: "تم الدفع: أصدر الإيصال" }).click();
  await waitFor(async () => (await milestones())[1]?.status === "paid", "interim paid");
  for (const to of ["in_progress", "internal_qa", "client_review", "awaiting_balance"]) {
    await admin.reload();
    await admin.selectOption("#to", to);
    await admin.getByRole("button", { name: "تغيير الحالة" }).click();
    await waitFor(async () => (await status()) === to, to);
  }
  await admin.reload();
  await row("الدفعة الأخيرة").getByText("تسجيل الدفع يدويًا + إيصال").click();
  await row("الدفعة الأخيرة").getByRole("button", { name: "تم الدفع: أصدر الإيصال" }).click();
  await waitFor(async () => (await status()) === "delivered", "delivered");
  const [final] = await db
    .select()
    .from(deliverables)
    .where(and(eq(deliverables.projectId, project.id), eq(deliverables.kind, "final")));
  assert.equal(final?.released, true);
  ok("last payment -> delivered automatically; final files released");

  await client.reload();
  assert.equal((await client.request.get(`${url}/files/${final!.id}`)).status(), 403);
  await client.getByRole("button", { name: "Email me a verification code" }).click();
  await client.getByText(/We sent a code to/).waitFor();
  await client.fill("#otp-code", await latestOtp(db));
  await client.getByRole("button", { name: "Verify and unlock files" }).click();
  const download = client.getByRole("link", { name: "Download", exact: true });
  await download.waitFor();
  const file = await client.request.get(`${BASE}${await download.getAttribute("href")}`);
  assert.equal((await file.text()).trim(), "final deliverable content");
  ok("final file: refused before OTP, downloadable after OTP");
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Development only");
  const { db, close } = createDb(required("DATABASE_URL"), { max: 2 });
  const browser = await chromium.launch({ executablePath: required("CHROMIUM_PATH") });
  const errors: string[] = [];
  try {
    const admin = await login(browser);
    admin.on("pageerror", (e) => errors.push(e.message));
    ok("admin login");
    await admin.goto(`${BASE}/admin/settings`);
    const salesOn = (await admin.locator("text=SALES_ENABLED=true").count()) > 0;
    console.log(`Server sales mode: ${salesOn ? "ON" : "OFF"}`);
    await (salesOn ? salesOnFlow(db, browser, admin) : salesOffFlow(db, browser, admin));
    assert.deepEqual(errors, [], "no browser errors");
    console.log("All checks passed.");
  } finally {
    await browser.close();
    await close();
  }
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
