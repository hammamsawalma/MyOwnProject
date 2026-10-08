/**
 * Development seed: one demo client and one demo project walked through the
 * lifecycle with real domain services (quote, OTP acceptance, payments,
 * receipts, deliverables, events).
 *
 *   pnpm db:seed                      # walk to "warranty" (MVP done-criteria)
 *   pnpm db:seed -- --until=quote_sent
 *
 * Payments are simulated with an explicit sales override, so this script refuses
 * to run in production. It never touches real money or real payment providers.
 */
import "./load-env";
import { eq } from "drizzle-orm";
import { createDb } from "@/db/client";
import { clients } from "@/db/schema";
import { createMagicLink } from "@/lib/magic-links";
import { issueOtp } from "@/lib/otp";
import { closePdfBrowser } from "@/lib/pdf/render";
import { MAIN_STATUSES, type MainStatus } from "@/lib/project-status";
import { createCost } from "@/lib/services/costs";
import { addDeliverable } from "@/lib/services/deliverables";
import { generateDocumentPdf, listProjectDocuments } from "@/lib/services/documents";
import { listMilestones, recordPayment, sendPaymentRequest } from "@/lib/services/payments";
import { createClient, createProject, getProject, transitionProject } from "@/lib/services/projects";
import { acceptQuote, createQuoteDraft, sendQuote } from "@/lib/services/quotes";

const DEMO_EMAIL = "demo.client@example.com";
const DEMO_SALES = { salesEnabled: true } as const;

function parseUntil(): MainStatus {
  const arg = process.argv.find((a) => a.startsWith("--until="))?.split("=")[1] ?? "warranty";
  if (!(MAIN_STATUSES as readonly string[]).includes(arg)) {
    throw new Error(`--until must be one of: ${MAIN_STATUSES.join(", ")}`);
  }
  return arg as MainStatus;
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (copy .env.example to .env)");
  const until = parseUntil();
  const { db, close } = createDb(url, { max: 2 });

  try {
    const [existing] = await db.select().from(clients).where(eq(clients.email, DEMO_EMAIL));
    if (existing) {
      console.log("Demo data already present. Run `pnpm db:reset` for a fresh database.");
      return;
    }

    const client = await createClient(db, {
      name: "أحمد التجريبي",
      type: "company",
      companyName: "مؤسسة المثال التجارية",
      email: DEMO_EMAIL,
      phoneE164: "+966500000000",
      country: "SA",
      language: "ar",
      source: "seed",
    });
    const project = await createProject(db, {
      clientId: client.id,
      title: "موظف استقبال واتساب ذكي (مشروع تجريبي)",
      serviceKey: "whatsapp-ai-receptionist",
      currency: "USD",
      source: "seed",
    });
    const projectId = project.id;
    const to = (status: MainStatus) => transitionProject(db, { projectId, to: status, actor: "admin" });

    let quoteId = "";
    const steps: [MainStatus, () => Promise<unknown>][] = [
      ["qualified", () => to("qualified")],
      ["discovery", () => to("discovery")],
      [
        "quote_draft",
        async () => {
          await to("quote_draft");
          const { quote } = await createQuoteDraft(db, {
            projectId,
            currency: "USD",
            pricingModel: "package",
            packageTier: "standard",
            title: "موظف استقبال واتساب ذكي: الباقة القياسية",
            summary: "بوت يرد على استفسارات العملاء على واتساب ويحجز المواعيد ويحوّل الحالات المعقدة لموظف.",
            scopeIncluded: ["ربط البوت برقم واتساب الأعمال", "تدريب البوت على 40 سؤالًا شائعًا", "لوحة متابعة المحادثات"],
            scopeExcluded: ["رسوم ميتا لرسائل واتساب", "تكاليف استهلاك الذكاء الاصطناعي بعد الشهر الأول"],
            assumptions: ["يوفر العميل حساب Meta Business موثّقًا"],
            acceptanceCriteria: ["يجيب البوت إجابة صحيحة على 40 سؤالًا متفقًا عليها"],
            timeline: "10 أيام عمل من استلام المدخلات",
            revisionsIncluded: 2,
            warrantyDays: 30,
            lineItems: [
              { description: "إعداد البوت وربطه بواتساب", unitPriceMinor: 55_000 },
              { description: "تدريب البوت على الأسئلة الشائعة", unitPriceMinor: 20_000 },
              { description: "جلسة تسليم وشرح (ساعة)", quantity: 1, unitPriceMinor: 5_000 },
            ],
          });
          quoteId = quote.id;
        },
      ],
      ["quote_sent", () => sendQuote(db, { quoteId })],
      [
        "awaiting_deposit",
        async () => {
          const otp = await issueOtp(db, { projectId, purpose: "accept_quote", email: DEMO_EMAIL });
          if (!otp.ok) throw new Error("OTP rate limited");
          await acceptQuote(db, {
            projectId,
            quoteId,
            otpCode: otp.code,
            termsAccepted: true,
            startImmediatelyWaiver: true,
            ip: "127.0.0.1",
            userAgent: "seed-script",
            sales: DEMO_SALES,
          });
        },
      ],
      ["kickoff", () => payNext(db, projectId)],
      ["in_progress", () => to("in_progress")],
      ["internal_qa", () => to("internal_qa")],
      [
        "client_review",
        async () => {
          await to("client_review");
          await addDeliverable(db, {
            projectId,
            kind: "preview",
            title: "فيديو معاينة البوت",
            externalUrl: "https://example.com/demo-preview",
          });
        },
      ],
      ["revisions", () => to("revisions")],
      ["client_review", () => to("client_review")],
      ["awaiting_balance", () => to("awaiting_balance")],
      [
        "delivered",
        async () => {
          await addDeliverable(db, {
            projectId,
            kind: "final",
            title: "دليل التشغيل وملفات الإعداد",
            file: { data: Buffer.from("# Demo handover\n"), fileName: "handover.md", mimeType: "text/markdown" },
          });
          await payNext(db, projectId);
        },
      ],
      ["warranty", () => to("warranty")],
      ["closed", () => to("closed")],
      ["follow_up", () => to("follow_up")],
    ];

    for (const [status, run] of steps) {
      const current = (await getProject(db, projectId)).status;
      if (current === until) break;
      await run();
      console.log(`  -> ${status}`);
    }

    const extraProjectIds = await seedExtraProjects(db);

    await createCost(db, {
      incurredOn: new Date().toISOString().slice(0, 10),
      category: "subscription",
      vendor: "Demo SaaS",
      description: "Demo recurring subscription",
      amountMinor: 2_000,
      currency: "USD",
      recurring: "monthly",
    });

    const allProjectIds = [projectId, ...extraProjectIds];
    if (process.env.CHROMIUM_PATH) {
      for (const id of allProjectIds) {
        for (const doc of await listProjectDocuments(db, id)) {
          const { key } = await generateDocumentPdf(db, doc.id);
          console.log(`  PDF ${doc.ref}: storage/${key}`);
        }
      }
      await closePdfBrowser();
    }

    console.log("");
    for (const id of allProjectIds) {
      const link = await createMagicLink(db, { projectId: id });
      const project = await getProject(db, id);
      console.log(`Demo project ${project.ref} is "${project.status}". Tracking link (dev): ${link.url}`);
    }
  } finally {
    await close();
  }
}

/** Two more demo projects: an EUR custom quote awaiting the client (30/40/30) and a fresh lead. */
async function seedExtraProjects(db: ReturnType<typeof createDb>["db"]): Promise<string[]> {
  const lena = await createClient(db, {
    name: "Lena Fischer",
    type: "company",
    companyName: "Fischer Handel GmbH",
    email: "lena.demo@example.com",
    country: "DE",
    language: "en",
    source: "seed",
  });
  const sheets = await createProject(db, {
    clientId: lena.id,
    title: "أتمتة تقارير المبيعات في Google Sheets",
    serviceKey: "sheets-automation",
    currency: "EUR",
    source: "seed",
  });
  await transitionProject(db, { projectId: sheets.id, to: "discovery", actor: "admin" });
  await transitionProject(db, { projectId: sheets.id, to: "quote_draft", actor: "admin" });
  const { quote } = await createQuoteDraft(db, {
    projectId: sheets.id,
    currency: "EUR",
    title: "أتمتة تقارير المبيعات الأسبوعية",
    summary: "تجميع بيانات المبيعات من المتجر والفواتير في Google Sheets تلقائيًا، وإرسال تقرير أسبوعي بالبريد.",
    scopeIncluded: ["ربط المتجر الإلكتروني ونظام الفواتير", "لوحة تقارير في Google Sheets", "تقرير أسبوعي آلي بالبريد"],
    scopeExcluded: ["اشتراكات الأدوات الخارجية", "إدخال البيانات التاريخية قبل 2026"],
    assumptions: ["صلاحيات قراءة لحساب المتجر والفواتير"],
    acceptanceCriteria: ["التقرير يطابق أرقام المتجر لأسبوعين متتاليين"],
    timeline: "3 أسابيع من استلام الصلاحيات",
    revisionsIncluded: 2,
    warrantyDays: 30,
    lineItems: [
      { description: "تحليل المصادر وتصميم التقرير", unitPriceMinor: 60_000 },
      { description: "بناء الأتمتة والربط", unitPriceMinor: 140_000 },
      { description: "اختبار وتسليم مع جلسة شرح", unitPriceMinor: 40_000 },
    ],
  });
  await sendQuote(db, { quoteId: quote.id });
  console.log("  -> extra project with an EUR quote awaiting the client");

  const lead = await createProject(db, {
    clientId: (await createClient(db, { name: "خالد", email: "khaled.demo@example.com", country: "AE", source: "seed" })).id,
    title: "بوت حجز مواعيد لعيادة أسنان",
    serviceKey: "whatsapp-ai-receptionist",
    source: "seed",
  });
  console.log("  -> extra lead");
  return [sheets.id, lead.id];
}

async function payNext(db: ReturnType<typeof createDb>["db"], projectId: string) {
  const next = (await listMilestones(db, projectId)).find((m) => m.status !== "paid");
  if (!next) throw new Error("No unpaid milestone");
  await sendPaymentRequest(db, {
    milestoneId: next.id,
    payUrl: "https://example.com/demo-payment",
    provider: "demo",
    sales: DEMO_SALES,
  });
  await recordPayment(db, {
    milestoneId: next.id,
    provider: "demo",
    providerRef: "DEMO-NO-REAL-MONEY",
    evidenceNote: "Seed data: simulated payment, no real money",
    sales: DEMO_SALES,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
