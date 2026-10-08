import type { Metadata } from "next";
import { Badge, Card, DescriptionList, Ltr, Money, Notice, PageHeader } from "@/components/ui";
import { brand, whatsappUrl } from "@/config/brand";
import { env } from "@/config/env";
import { policy } from "@/config/policy";
import { getDb } from "@/db/client";
import { AR_NOUNS, arCount } from "@/lib/plural";
import { requireAdmin } from "@/lib/auth/next-session";
import { getSalesConfig } from "@/lib/sales";
import { getDocumentMode, getPaymentPolicy } from "@/lib/settings";

export const metadata: Metadata = { title: "الإعدادات" };

const DOCUMENT_MODE_LABELS = {
  receipt: "إيصال دفع (ليست فاتورة ضريبية)",
  tax_invoice_via_provider: "فاتورة ضريبية عبر مزوّد معتمد",
} as const;

function Swatch({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-6 rounded border border-border" style={{ background: value }} aria-hidden />
      <span className="text-sm">{name}</span>
      <Ltr className="text-xs text-muted">{value}</Ltr>
    </div>
  );
}

const pct = (list: readonly number[]) => list.map((p) => `${p}%`).join(" / ");

/** Read-only: values come from .env and src/config/*.ts; editing them is a code/env change. */
export default async function SettingsPage() {
  await requireAdmin();
  const db = getDb();
  const [documentMode, paymentPolicy] = await Promise.all([getDocumentMode(db), getPaymentPolicy(db)]);
  const { salesEnabled } = getSalesConfig();
  const e = env();

  return (
    <>
      <PageHeader title="الإعدادات" subtitle="للعرض فقط: التعديل من ملف .env أو src/config" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="البيع" description="المفتاح SALES_ENABLED في .env">
          <div className="flex items-center gap-3">
            <Badge tone={salesEnabled ? "success" : "warning"} className="text-sm">
              {salesEnabled ? "مفعّل" : "مطفأ"}
            </Badge>
            <span className="text-sm text-muted">
              <Ltr>SALES_ENABLED={salesEnabled ? "true" : "false"}</Ltr>
            </span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            {salesEnabled
              ? "روابط الدفع وقبول العروض وتسجيل الدفعات مفعّلة."
              : "لا روابط دفع ولا أزرار دفع ولا قبول عروض ولا تسجيل دفعات حتى صدور التصريح. القيمة true وحدها تفعّل البيع."}
          </p>
        </Card>

        <Card title="المستندات" description="الإعداد document_mode في قاعدة البيانات">
          <DescriptionList
            items={[
              { label: "وضع المستندات", value: DOCUMENT_MODE_LABELS[documentMode] },
              { label: "نسخة الشروط", value: <Ltr>{policy.termsVersion}</Ltr> },
              { label: "صلاحية العرض", value: arCount(policy.quoteValidityDays, AR_NOUNS.day) },
              {
                label: "خانة البدء الفوري والتنازل عن العدول",
                value: policy.requireStartImmediatelyWaiver ? "إلزامية" : "اختيارية",
              },
            ]}
          />
        </Card>

        <Card title="البراند" description="من ملف واحد: src/config/brand.ts (يُستبدل بعد اختبار الاسم)">
          <DescriptionList
            items={[
              { label: "الاسم", value: `${brand.name.ar} · ${brand.name.en}` },
              { label: "الاسم المختصر", value: `${brand.shortName.ar} · ${brand.shortName.en}` },
              { label: "نص الشعار", value: `${brand.logoText.ar} · ${brand.logoText.en}` },
              { label: "الشعار النصي", value: brand.tagline.ar },
              { label: "الدومين", value: <Ltr>{brand.domain}</Ltr> },
              { label: "البريد", value: <Ltr>{brand.contact.email}</Ltr> },
              {
                label: "واتساب",
                value: whatsappUrl() ? (
                  <Ltr>{brand.contact.whatsappE164}</Ltr>
                ) : (
                  <span className="text-muted">غير مضبوط</span>
                ),
              },
            ]}
          />
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Object.entries(brand.colors).map(([name, value]) => (
              <Swatch key={name} name={name} value={value} />
            ))}
          </div>
        </Card>

        <Card title="سياسة الدفعات" description="افتراضية من البحث (ق10 معلّق)، قابلة للتغيير من جدول الإعدادات">
          <DescriptionList
            items={[
              {
                label: "100% مقدمًا تحت",
                value: <Money minor={paymentPolicy.fullUpfrontBelowMinor} currency="USD" />,
              },
              {
                label: `${pct(paymentPolicy.twoPartSplit)} حتى`,
                value: <Money minor={paymentPolicy.twoPartMaxMinor} currency="USD" />,
              },
              { label: "فوق ذلك", value: pct(paymentPolicy.largeSplit) },
              {
                label: "الإضافات",
                value: (
                  <>
                    100% تحت <Money minor={paymentPolicy.addonFullUpfrontBelowMinor} currency="USD" />، وإلا{" "}
                    {pct(paymentPolicy.addonSplit)}
                  </>
                ),
              },
              { label: "الملفات النهائية", value: "بعد سداد آخر دفعة فقط" },
            ]}
          />
          <p className="mt-3 text-xs text-muted">الحدود نفسها بعملة العرض (دولار أو يورو).</p>
        </Card>

        <Card title="البيئة" className="lg:col-span-2">
          <DescriptionList
            items={[
              { label: "البيئة", value: <Ltr>{e.NODE_ENV}</Ltr> },
              { label: "الرابط الأساسي", value: <Ltr>{e.APP_BASE_URL}</Ltr> },
              { label: "المنطقة الزمنية", value: <Ltr>{e.BUSINESS_TIMEZONE}</Ltr> },
              {
                label: "البريد",
                value: e.RESEND_API_KEY ? "Resend مضبوط" : "صندوق صادر للتطوير (بلا RESEND_API_KEY)",
              },
              { label: "Chromium لملفات PDF", value: e.CHROMIUM_PATH ? <Ltr>{e.CHROMIUM_PATH}</Ltr> : "غير مضبوط" },
              { label: "صلاحية رابط العميل", value: `${e.MAGIC_LINK_TTL_DAYS} يومًا` },
              {
                label: "رمز التحقق",
                value: `${policy.otp.length} أرقام · ${policy.otp.ttlMinutes} دقائق · ${policy.otp.maxAttempts} محاولات`,
              },
              { label: "التخزين", value: <Ltr>{e.STORAGE_DIR}</Ltr> },
            ]}
          />
          {!e.CHROMIUM_PATH && (
            <Notice tone="warning" className="mt-4">
              اضبط CHROMIUM_PATH في .env ليعمل توليد ملفات PDF.
            </Notice>
          )}
        </Card>
      </div>
    </>
  );
}
