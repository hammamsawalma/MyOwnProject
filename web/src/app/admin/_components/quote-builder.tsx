"use client";

import { useMemo, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/client";
import { Button, Card, Checkbox, Field, Input, Money, Notice, Select, Textarea, cx } from "@/components/ui";
import type { PackageTier, PricingModel, QuoteKind } from "@/lib/domain-enums";
import { lineTotal, parseMoney, splitByPercentages, type Currency } from "@/lib/money";
import {
  defaultPaymentPlan,
  MILESTONE_KIND_LABELS,
  planKindFor,
  type PaymentPolicy,
  type PlannedMilestone,
} from "@/lib/payment-plan";
import type { FormAction } from "@/lib/ui/action-state";
import { AR_NOUNS, arCount } from "@/lib/plural";
import { PACKAGE_TIER_LABELS } from "@/lib/ui/labels";

export interface QuoteBuilderDefaults {
  kind: QuoteKind;
  changeRequestId: string | null;
  pricingModel: PricingModel;
  packageTier: PackageTier | null;
  currency: Currency;
  title: string;
  summary: string;
  scopeIncluded: string[];
  scopeExcluded: string[];
  assumptions: string[];
  acceptanceCriteria: string[];
  timeline: string;
  revisionsIncluded: number;
  warrantyDays: number;
  thirdPartyCosts: string;
  notes: string;
  discountMinor: number;
  lineItems: { description: string; quantity: number; unitPriceMinor: number }[];
  /** null = use the policy defaults (recomputed when the total changes). */
  paymentPlan: PlannedMilestone[] | null;
}

interface LineRow {
  key: number;
  description: string;
  quantity: string;
  unitPrice: string;
}

const toMajorString = (minor: number) => (minor / 100).toFixed(2);

function tryMoney(value: string, currency: Currency): number | null {
  try {
    return parseMoney(value || "0", currency);
  } catch {
    return null;
  }
}

const splitLines = (value: string) =>
  value
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

export function QuoteBuilder({
  action,
  defaults,
  policy,
  termsVersion,
  validityDays,
}: {
  action: FormAction;
  defaults: QuoteBuilderDefaults;
  policy: PaymentPolicy;
  termsVersion: string;
  validityDays: number;
}) {
  const [pricingModel, setPricingModel] = useState<PricingModel>(defaults.pricingModel);
  const [packageTier, setPackageTier] = useState<PackageTier>(defaults.packageTier ?? "standard");
  const [currency, setCurrency] = useState<Currency>(defaults.currency);
  const [title, setTitle] = useState(defaults.title);
  const [summary, setSummary] = useState(defaults.summary);
  const [included, setIncluded] = useState(defaults.scopeIncluded.join("\n"));
  const [excluded, setExcluded] = useState(defaults.scopeExcluded.join("\n"));
  const [assumptions, setAssumptions] = useState(defaults.assumptions.join("\n"));
  const [criteria, setCriteria] = useState(defaults.acceptanceCriteria.join("\n"));
  const [timeline, setTimeline] = useState(defaults.timeline);
  const [revisions, setRevisions] = useState(String(defaults.revisionsIncluded));
  const [warranty, setWarranty] = useState(String(defaults.warrantyDays));
  const [thirdParty, setThirdParty] = useState(defaults.thirdPartyCosts);
  const [notes, setNotes] = useState(defaults.notes);
  const [discount, setDiscount] = useState(defaults.discountMinor ? toMajorString(defaults.discountMinor) : "");
  const [nextKey, setNextKey] = useState(defaults.lineItems.length + 1);
  const [rows, setRows] = useState<LineRow[]>(
    (defaults.lineItems.length ? defaults.lineItems : [{ description: "", quantity: 1, unitPriceMinor: 0 }]).map(
      (l, i) => ({
        key: i,
        description: l.description,
        quantity: String(l.quantity),
        unitPrice: l.unitPriceMinor ? toMajorString(l.unitPriceMinor) : "",
      }),
    ),
  );
  // Manual plan as percentages; milestone kinds follow position (deposit first, balance last).
  const [customPlan, setCustomPlan] = useState<string[] | null>(
    defaults.paymentPlan ? defaults.paymentPlan.map((m) => String(m.percent)) : null,
  );

  const planType = defaults.kind === "addon" ? "addon" : "project";
  // Add-ons are added to the project total, so they keep the project currency.
  const currencyLocked = defaults.kind === "addon";

  const computed = useMemo(() => {
    const errors: string[] = [];
    const lines = rows.map((r) => {
      const quantity = Number(r.quantity);
      const unit = tryMoney(r.unitPrice, currency);
      const validQty = Number.isInteger(quantity) && quantity > 0;
      return {
        description: r.description.trim(),
        quantity: validQty ? quantity : 0,
        unitPriceMinor: unit ?? 0,
        totalMinor: validQty && unit !== null ? lineTotal(quantity, unit) : 0,
        valid: validQty && unit !== null && r.description.trim() !== "",
      };
    });
    if (lines.some((l) => !l.valid)) errors.push("كل بند يحتاج وصفًا وكمية صحيحة (عدد صحيح) وسعرًا صالحًا.");
    const subtotal = lines.reduce((acc, l) => acc + l.totalMinor, 0);
    const discountMinor = tryMoney(discount, currency);
    if (discountMinor === null) errors.push("الخصم غير صالح.");
    else if (discountMinor > subtotal) errors.push("الخصم أكبر من المجموع.");
    const total = Math.max(0, subtotal - (discountMinor ?? 0));
    if (total <= 0) errors.push("إجمالي العرض يجب أن يكون أكبر من صفر.");

    let plan: PlannedMilestone[] = total > 0 ? defaultPaymentPlan(total, currency, policy, planType) : [];
    if (customPlan && total > 0) {
      const percents = customPlan.map(Number);
      const sum = percents.reduce((a, b) => a + b, 0);
      if (customPlan.length === 0 || percents.some((p) => !Number.isInteger(p) || p <= 0)) {
        errors.push("نسب جدول الدفع يجب أن تكون أعدادًا صحيحة موجبة.");
      } else if (sum !== 100) {
        errors.push(`مجموع نسب جدول الدفع ${sum}% ويجب أن يكون 100%.`);
      } else {
        const amounts = splitByPercentages(total, percents);
        plan = customPlan.map((_, i) => ({
          kind: planKindFor(i, customPlan.length, planType),
          sequence: i + 1,
          percent: percents[i] ?? 0,
          amountMinor: amounts[i] ?? 0,
        }));
        if (plan.some((m) => m.amountMinor <= 0)) errors.push("كل دفعة يجب أن تكون أكبر من صفر.");
      }
    }
    if (!title.trim()) errors.push("عنوان العرض مطلوب.");
    if (!/^\d+$/.test(revisions) || !/^\d+$/.test(warranty)) errors.push("المراجعات والضمان أعداد صحيحة.");
    return { lines, subtotal, discountMinor: discountMinor ?? 0, total, plan, errors };
  }, [rows, currency, discount, customPlan, policy, planType, title, revisions, warranty]);

  const payload = JSON.stringify({
    kind: defaults.kind,
    changeRequestId: defaults.changeRequestId,
    pricingModel,
    packageTier: pricingModel === "package" ? packageTier : null,
    currency,
    title: title.trim(),
    summary: summary.trim() || null,
    scopeIncluded: splitLines(included),
    scopeExcluded: splitLines(excluded),
    assumptions: splitLines(assumptions),
    acceptanceCriteria: splitLines(criteria),
    timeline: timeline.trim() || null,
    revisionsIncluded: Number(revisions) || 0,
    warrantyDays: Number(warranty) || 0,
    thirdPartyCosts: thirdParty.trim() || null,
    notes: notes.trim() || null,
    discountMinor: computed.discountMinor,
    lineItems: computed.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
    })),
    paymentPlan: customPlan ? computed.plan : null,
  });

  function updateRow(key: number, patch: Partial<LineRow>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function onTierChange(tier: PackageTier) {
    setPackageTier(tier);
    const label = `الباقة ${PACKAGE_TIER_LABELS[tier].ar}`;
    setRows((current) =>
      current.map((r, i) =>
        i === 0 && (!r.description || r.description.startsWith("الباقة")) ? { ...r, description: label } : r,
      ),
    );
  }

  return (
    <ActionForm action={action} className="grid gap-6 lg:grid-cols-3">
      <input type="hidden" name="payload" value={payload} />
      <div className="min-w-0 space-y-6 lg:col-span-2">
        <Card title="البيانات الأساسية">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="عنوان العرض *" htmlFor="q-title" className="sm:col-span-2">
              <Input id="q-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </Field>
            <Field label="نوع التسعير" htmlFor="q-model">
              <Select
                id="q-model"
                value={pricingModel}
                onChange={(e) => {
                  const model = e.target.value as PricingModel;
                  setPricingModel(model);
                  if (model === "package") onTierChange(packageTier);
                }}
              >
                <option value="custom">عرض مخصص (بنود)</option>
                <option value="package">باقة ثابتة</option>
              </Select>
            </Field>
            {pricingModel === "package" ? (
              <Field label="الباقة" htmlFor="q-tier" hint="أسعار الباقات لم تُحسم بعد (ق19)؛ اكتب السعر في البند">
                <Select id="q-tier" value={packageTier} onChange={(e) => onTierChange(e.target.value as PackageTier)}>
                  <option value="basic">الأساسية (Basic)</option>
                  <option value="standard">القياسية (Standard)</option>
                  <option value="premium">المتقدمة (Premium)</option>
                </Select>
              </Field>
            ) : (
              <div className="hidden sm:block" />
            )}
            <Field
              label="العملة"
              htmlFor="q-currency"
              hint={currencyLocked ? "عرض الإضافة بعملة المشروع نفسها" : "رسوم الدفع ضمن السعر (لا بند رسوم)"}
            >
              <Select
                id="q-currency"
                value={currency}
                disabled={currencyLocked}
                onChange={(e) => setCurrency(e.target.value as Currency)}
              >
                <option value="USD">دولار (USD)</option>
                <option value="EUR">يورو (EUR)</option>
              </Select>
            </Field>
            <Field label="ملخص الحاجة" htmlFor="q-summary" className="sm:col-span-2" hint="سطران أو ثلاثة بلغة العميل">
              <Textarea id="q-summary" value={summary} onChange={(e) => setSummary(e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card title="البنود والسعر">
          <div className="space-y-3">
            {rows.map((r, i) => (
              <div
                key={r.key}
                className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_80px_130px_auto] sm:items-end"
              >
                <Field label={`البند ${i + 1}`} htmlFor={`line-d-${r.key}`}>
                  <Input
                    id={`line-d-${r.key}`}
                    value={r.description}
                    onChange={(e) => updateRow(r.key, { description: e.target.value })}
                  />
                </Field>
                <Field label="الكمية" htmlFor={`line-q-${r.key}`}>
                  <Input
                    id={`line-q-${r.key}`}
                    dir="ltr"
                    inputMode="numeric"
                    value={r.quantity}
                    onChange={(e) => updateRow(r.key, { quantity: e.target.value })}
                  />
                </Field>
                <Field label={`سعر الوحدة (${currency})`} htmlFor={`line-p-${r.key}`}>
                  <Input
                    id={`line-p-${r.key}`}
                    dir="ltr"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={r.unitPrice}
                    onChange={(e) => updateRow(r.key, { unitPrice: e.target.value })}
                  />
                </Field>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={rows.length === 1}
                  onClick={() => setRows((current) => current.filter((x) => x.key !== r.key))}
                  aria-label={`حذف البند ${i + 1}`}
                >
                  حذف
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setRows((current) => [...current, { key: nextKey, description: "", quantity: "1", unitPrice: "" }]);
                setNextKey((k) => k + 1);
              }}
            >
              + إضافة بند
            </Button>
            <Field label={`خصم (${currency})`} htmlFor="q-discount" className="max-w-xs">
              <Input
                id="q-discount"
                dir="ltr"
                inputMode="decimal"
                placeholder="0.00"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </Field>
          </div>
        </Card>

        <Card title="النطاق والقبول" description="سطر لكل بند">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="يشمل" htmlFor="q-inc">
              <Textarea id="q-inc" rows={5} value={included} onChange={(e) => setIncluded(e.target.value)} />
            </Field>
            <Field label="لا يشمل" htmlFor="q-exc" hint="أهم قسم لمنع الخلاف">
              <Textarea id="q-exc" rows={5} value={excluded} onChange={(e) => setExcluded(e.target.value)} />
            </Field>
            <Field label="الافتراضات والمطلوب من العميل" htmlFor="q-ass">
              <Textarea id="q-ass" rows={4} value={assumptions} onChange={(e) => setAssumptions(e.target.value)} />
            </Field>
            <Field label="معايير القبول" htmlFor="q-acc">
              <Textarea id="q-acc" rows={4} value={criteria} onChange={(e) => setCriteria(e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card title="الجدول والمراجعات والضمان">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="الجدول الزمني" htmlFor="q-timeline" className="sm:col-span-3">
              <Input
                id="q-timeline"
                value={timeline}
                onChange={(e) => setTimeline(e.target.value)}
                placeholder="مثل: 10 أيام عمل من استلام المدخلات"
              />
            </Field>
            <Field label="جولات المراجعة" htmlFor="q-rev">
              <Input
                id="q-rev"
                dir="ltr"
                inputMode="numeric"
                value={revisions}
                onChange={(e) => setRevisions(e.target.value)}
              />
            </Field>
            <Field label="الضمان (أيام)" htmlFor="q-war">
              <Input
                id="q-war"
                dir="ltr"
                inputMode="numeric"
                value={warranty}
                onChange={(e) => setWarranty(e.target.value)}
              />
            </Field>
            <Field
              label="تكاليف الطرف الثالث"
              htmlFor="q-3p"
              className="sm:col-span-3"
              hint="ما يدفعه العميل مباشرة (تقديرًا)"
            >
              <Input id="q-3p" value={thirdParty} onChange={(e) => setThirdParty(e.target.value)} />
            </Field>
            <Field label="ملاحظات داخلية" htmlFor="q-notes" className="sm:col-span-3" hint="لا تظهر في العرض">
              <Textarea id="q-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
        </Card>
      </div>

      <div className="min-w-0 space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Card title="الملخص">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-muted">المجموع</dt>
              <dd>
                <Money minor={computed.subtotal} currency={currency} />
              </dd>
            </div>
            {computed.discountMinor > 0 && (
              <div className="flex justify-between gap-2">
                <dt className="text-muted">الخصم</dt>
                <dd>
                  <Money minor={-computed.discountMinor} currency={currency} />
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-2 border-t border-border pt-2 text-base font-bold">
              <dt>الإجمالي</dt>
              <dd>
                <Money minor={computed.total} currency={currency} />
              </dd>
            </div>
          </dl>

          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-2 text-sm font-bold">جدول الدفع</p>
            <Checkbox
              checked={customPlan !== null}
              onChange={(e) => setCustomPlan(e.target.checked ? computed.plan.map((m) => String(m.percent)) : null)}
              label="تعديل الجدول يدويًا"
            />
            {customPlan === null ? (
              <p className="mt-1 text-xs text-muted">
                افتراضي حسب السياسة: 100% تحت 150، و50/50 حتى 2,000، و30/40/30 فوقها
                {planType === "addon" && " (الإضافات: 100% تحت 150، وإلا 50/50)"}.
              </p>
            ) : null}
            <ul className="mt-3 space-y-2">
              {(customPlan ?? computed.plan.map((m) => String(m.percent))).map((percent, i, all) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1">
                    {MILESTONE_KIND_LABELS[planKindFor(i, all.length, planType)].ar}
                  </span>
                  {customPlan ? (
                    <>
                      <input
                        aria-label={`نسبة الدفعة ${i + 1}`}
                        dir="ltr"
                        inputMode="numeric"
                        value={percent}
                        onChange={(e) => setCustomPlan((plan) => plan!.map((x, j) => (j === i ? e.target.value : x)))}
                        className="h-8 w-14 rounded border border-border px-1 text-center text-xs"
                      />
                      <span className="text-xs">%</span>
                      <button
                        type="button"
                        onClick={() => setCustomPlan((plan) => plan!.filter((_, j) => j !== i))}
                        className="text-xs text-danger"
                        aria-label={`حذف الدفعة ${i + 1}`}
                      >
                        ✕
                      </button>
                    </>
                  ) : (
                    <bdi dir="ltr" className="text-xs text-muted">
                      {percent}%
                    </bdi>
                  )}
                  <Money
                    minor={computed.plan[i]?.amountMinor ?? 0}
                    currency={currency}
                    className={cx("text-xs", customPlan && "w-20 text-end")}
                  />
                </li>
              ))}
            </ul>
            {customPlan && (
              <p className="mt-1 text-xs text-muted">
                {planType === "addon"
                  ? "كل دفعات الإضافة من نوع «دفعة إضافة»."
                  : "الأولى دائمًا «الدفعة المقدمة» والأخيرة «الدفعة الأخيرة»؛ بدء العمل يتبع سداد الأولى."}
              </p>
            )}
            {customPlan && (
              <Button
                size="sm"
                variant="ghost"
                className="mt-2"
                onClick={() => setCustomPlan((plan) => [...(plan ?? []), "0"])}
              >
                + دفعة
              </Button>
            )}
          </div>
        </Card>

        {computed.errors.length > 0 && (
          <Notice tone="danger">
            <ul className="list-inside list-disc space-y-0.5">
              {computed.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Notice>
        )}
        <p className="text-xs text-muted">
          تُحفظ كمسودة بلا رقم. عند «الإصدار» يأخذ العرض رقم Q نهائيًا، وصلاحية{" "}
          {arCount(validityDays, AR_NOUNS.day, { oblique: true })}، والشروط <bdi dir="ltr">{termsVersion}</bdi>، ولا
          يُعدّل بعدها.
        </p>
        <SubmitButton className="w-full" disabled={computed.errors.length > 0} pendingLabel="جارٍ الحفظ…">
          حفظ المسودة
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
