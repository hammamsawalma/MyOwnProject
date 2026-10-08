import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/client";
import {
  Card,
  EmptyState,
  Field,
  Input,
  Money,
  PageHeader,
  Select,
  TableWrap,
  buttonClass,
  td,
  th,
} from "@/components/ui";
import { getDb } from "@/db/client";
import { AR_NOUNS, arCount } from "@/lib/plural";
import { requireAdmin } from "@/lib/auth/next-session";
import { COST_CATEGORIES, COST_CATEGORY_LABELS_AR } from "@/lib/domain-enums";
import { CURRENCIES, type Currency } from "@/lib/money";
import { listProjects } from "@/lib/services/admin-queries";
import { costTotals, listCosts, upcomingRenewals } from "@/lib/services/costs";
import { dateInputValue, formatDate, formatMonth, monthRange, shiftMonth } from "@/lib/ui/format";
import { RECURRENCE_LABELS_AR } from "@/lib/ui/labels";
import { createCostAction, deleteCostAction } from "../../_actions/costs";

export const metadata: Metadata = { title: "التكاليف" };

export default async function CostsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireAdmin();
  const today = dateInputValue();
  const requested = (await searchParams).month;
  const month = requested && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : today.slice(0, 7);
  const range = monthRange(month);
  const db = getDb();
  const [rows, totals, renewals, allCosts, projects] = await Promise.all([
    listCosts(db, range),
    costTotals(db, range),
    upcomingRenewals(db, { today, days: 30 }),
    listCosts(db),
    listProjects(db, { status: "all" }),
  ]);

  const byCurrency = (currency: Currency) => totals.filter((t) => t.currency === currency);
  const recurring = allCosts.filter((c) => c.recurring !== "none");
  const monthlyCommitment = CURRENCIES.map((currency) => ({
    currency,
    minor: recurring
      .filter((c) => c.currency === currency)
      .reduce((acc, c) => acc + (c.recurring === "yearly" ? Math.round(c.amountMinor / 12) : c.amountMinor), 0),
  })).filter((x) => x.minor > 0);

  return (
    <>
      <PageHeader
        title="التكاليف"
        subtitle="سيرفرات، ودومينات، وإعلانات، واشتراكات، وأجور الفريق"
        actions={
          <div className="flex items-center gap-1">
            <Link href={`/admin/costs?month=${shiftMonth(month, -1)}`} className={buttonClass("secondary", "sm")}>
              → السابق
            </Link>
            <span className="px-2 text-sm font-bold">{formatMonth(month)}</span>
            <Link href={`/admin/costs?month=${shiftMonth(month, 1)}`} className={buttonClass("secondary", "sm")}>
              التالي ←
            </Link>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card title={`إجمالي ${formatMonth(month)} حسب الفئة`} description="بلا تحويل عملات: كل عملة على حدة">
            {totals.length === 0 ? (
              <EmptyState>لا تكاليف مسجّلة في هذا الشهر.</EmptyState>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {CURRENCIES.filter((c) => byCurrency(c).length).map((currency) => (
                  <div key={currency} className="rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          <th className={th}>الفئة</th>
                          <th className={`${th} text-end`}>{currency}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {byCurrency(currency).map((t) => (
                          <tr key={t.category}>
                            <td className={td}>{COST_CATEGORY_LABELS_AR[t.category]}</td>
                            <td className={`${td} text-end`}>
                              <Money minor={t.totalMinor} currency={currency} />
                            </td>
                          </tr>
                        ))}
                        <tr className="font-bold">
                          <td className="px-3 py-2.5">المجموع</td>
                          <td className="px-3 py-2.5 text-end">
                            <Money
                              minor={byCurrency(currency).reduce((a, t) => a + t.totalMinor, 0)}
                              currency={currency}
                            />
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="سجل الشهر" description={arCount(rows.length, AR_NOUNS.entry)}>
            {rows.length === 0 ? (
              <EmptyState>لا قيود.</EmptyState>
            ) : (
              <TableWrap>
                <table className="w-full min-w-[620px] text-sm">
                  <thead>
                    <tr>
                      <th className={th}>التاريخ</th>
                      <th className={th}>المورّد</th>
                      <th className={th}>الفئة</th>
                      <th className={th}>التكرار</th>
                      <th className={`${th} text-end`}>المبلغ</th>
                      <th className={th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.id}>
                        <td className={`${td} whitespace-nowrap`}>{formatDate(c.incurredOn)}</td>
                        <td className={td}>
                          {c.vendor}
                          {c.description && <p className="text-xs text-muted">{c.description}</p>}
                        </td>
                        <td className={td}>{COST_CATEGORY_LABELS_AR[c.category]}</td>
                        <td className={td}>
                          {RECURRENCE_LABELS_AR[c.recurring]}
                          {c.renewsOn && <p className="text-xs text-muted">يتجدد {formatDate(c.renewsOn)}</p>}
                        </td>
                        <td className={`${td} text-end`}>
                          <Money minor={c.amountMinor} currency={c.currency} />
                        </td>
                        <td className={td}>
                          <ActionForm action={deleteCostAction.bind(null, c.id)} confirm="حذف هذا القيد؟">
                            <SubmitButton size="sm" variant="ghost" className="h-7 px-2 text-xs">
                              حذف
                            </SubmitButton>
                          </ActionForm>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card title="إضافة تكلفة">
            <ActionForm action={createCostAction} className="space-y-3" resetOnSuccess>
              <div className="grid grid-cols-2 gap-3">
                <Field label="التاريخ" htmlFor="c-date">
                  <Input id="c-date" name="incurredOn" type="date" dir="ltr" required defaultValue={today} />
                </Field>
                <Field label="الفئة" htmlFor="c-cat">
                  <Select id="c-cat" name="category" defaultValue="subscription">
                    {COST_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {COST_CATEGORY_LABELS_AR[c]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="المورّد" htmlFor="c-vendor">
                <Input id="c-vendor" name="vendor" required placeholder="مثل: Hetzner، Meta Ads" />
              </Field>
              <Field label="الوصف" htmlFor="c-desc">
                <Input id="c-desc" name="description" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="المبلغ" htmlFor="c-amount">
                  <Input id="c-amount" name="amount" dir="ltr" inputMode="decimal" required placeholder="0.00" />
                </Field>
                <Field label="العملة" htmlFor="c-cur">
                  <Select id="c-cur" name="currency" defaultValue="USD">
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </Select>
                </Field>
                <Field label="التكرار" htmlFor="c-rec">
                  <Select id="c-rec" name="recurring" defaultValue="none">
                    <option value="none">مرة واحدة</option>
                    <option value="monthly">شهري</option>
                    <option value="yearly">سنوي</option>
                  </Select>
                </Field>
                <Field label="تاريخ التجديد" htmlFor="c-renew" hint="للمتكرر فقط">
                  <Input id="c-renew" name="renewsOn" type="date" dir="ltr" />
                </Field>
              </div>
              <Field label="المشروع (اختياري)" htmlFor="c-project" hint="لحساب ربحية المشروع">
                <Select id="c-project" name="projectId" defaultValue="">
                  <option value="">— بلا مشروع —</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.ref} · {p.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="الحملة (للإعلانات)" htmlFor="c-campaign">
                <Input id="c-campaign" name="campaign" />
              </Field>
              <SubmitButton size="sm">إضافة</SubmitButton>
            </ActionForm>
          </Card>

          <Card title="الالتزامات المتكررة" description="تقدير شهري (السنوي ÷ 12) من القيود المتكررة">
            {monthlyCommitment.length === 0 ? (
              <EmptyState>لا تكاليف متكررة.</EmptyState>
            ) : (
              <ul className="space-y-1 text-sm">
                {monthlyCommitment.map((m) => (
                  <li key={m.currency} className="flex justify-between">
                    <span className="text-muted">شهريًا ({m.currency})</span>
                    <Money minor={m.minor} currency={m.currency} className="font-bold" />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="تجديدات خلال 30 يومًا">
            {renewals.length === 0 ? (
              <EmptyState>لا تجديدات قريبة.</EmptyState>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {renewals.map((c) => (
                  <li key={c.id} className="flex justify-between gap-2 py-2">
                    <span>
                      {c.vendor}
                      <span className="block text-xs text-muted">{formatDate(c.renewsOn)}</span>
                    </span>
                    <Money minor={c.amountMinor} currency={c.currency} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
