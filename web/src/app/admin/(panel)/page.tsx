import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Card, EmptyState, Ltr, Money, PageHeader, cx } from "@/components/ui";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/next-session";
import { COST_CATEGORY_LABELS_AR } from "@/lib/domain-enums";
import { MILESTONE_KIND_LABELS } from "@/lib/payment-plan";
import { PROJECT_STATUSES, STATUS_LABELS_AR } from "@/lib/project-status";
import { getSalesConfig } from "@/lib/sales";
import { listPendingPayments, listProjects, listRecentEvents } from "@/lib/services/admin-queries";
import { getTodayOverview } from "@/lib/services/dashboard";
import { formatDate, formatDateTime } from "@/lib/ui/format";
import { MILESTONE_STATUS_LABELS, milestoneTone, ACTOR_LABELS_AR } from "@/lib/ui/labels";
import { eventTitleAr, StatusBadge } from "../_components/status";

export const metadata: Metadata = { title: "اليوم" };

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "warning" | "danger" }) {
  return (
    <div className="rounded-xl border border-border bg-white px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p
        className={cx(
          "mt-1 text-2xl font-bold tabular-nums",
          tone === "warning" ? "text-warning" : tone === "danger" ? "text-danger" : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

const projectHref = (id: string) => `/admin/projects/${id}`;

export default async function TodayPage() {
  await requireAdmin();
  const db = getDb();
  const [overview, recent, pending, projects] = await Promise.all([
    getTodayOverview(db),
    listRecentEvents(db, 12),
    listPendingPayments(db),
    listProjects(db),
  ]);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const { salesEnabled } = getSalesConfig();

  const replyCount = overview.needsReply.length + overview.openChangeRequests.length;
  const sentPayments = pending.filter((m) => m.status === "sent");
  const draftPayments = pending.filter((m) => m.status === "draft");
  const counts = new Map(overview.statusCounts.map((s) => [s.status, s.n]));

  return (
    <>
      <PageHeader title="اليوم" subtitle={formatDate(new Date())} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="تحتاج ردك" value={replyCount} tone={replyCount ? "warning" : undefined} />
        <Stat
          label="مشاريع متأخرة"
          value={overview.lateProjects.length}
          tone={overview.lateProjects.length ? "danger" : undefined}
        />
        <Stat label="دفعات بانتظار العميل" value={sentPayments.length + overview.awaitingBalance.length} />
        <Stat
          label="المحصّل هذا الشهر"
          value={
            overview.collectedThisMonth.length ? (
              <span className="flex flex-col text-lg">
                {overview.collectedThisMonth.map((c) => (
                  <Money key={c.currency} minor={c.totalMinor} currency={c.currency} />
                ))}
              </span>
            ) : (
              <Money minor={0} currency="USD" />
            )
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="تحتاج ردك" description="عملاء محتملون، ومسودات عروض، وطلبات تغيير مفتوحة">
          {replyCount === 0 ? (
            <EmptyState>لا شيء ينتظر ردك الآن.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {overview.needsReply.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                  <Link href={projectHref(p.id)} className="min-w-0 truncate hover:text-brand">
                    <Ltr className="text-xs text-muted">{p.ref}</Ltr> · {p.title}
                  </Link>
                  <StatusBadge status={p.status} />
                </li>
              ))}
              {overview.openChangeRequests.map((cr) => (
                <li key={cr.id} className="flex items-center justify-between gap-3 py-2.5">
                  <Link
                    href={`${projectHref(cr.projectId)}#change-requests`}
                    className="min-w-0 truncate hover:text-brand"
                  >
                    <Ltr className="text-xs text-muted">{projectById.get(cr.projectId)?.ref}</Ltr> · {cr.description}
                  </Link>
                  <Badge tone="warning">طلب تغيير</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="مشاريع متأخرة" description="تجاوزت الموعد المتفق عليه وما زالت قيد العمل">
          {overview.lateProjects.length === 0 ? (
            <EmptyState>لا مشاريع متأخرة.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {overview.lateProjects.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                  <Link href={projectHref(p.id)} className="min-w-0 truncate hover:text-brand">
                    <Ltr className="text-xs text-muted">{p.ref}</Ltr> · {p.title}
                  </Link>
                  <span className="shrink-0 text-xs text-danger">الموعد: {formatDate(p.dueAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="الدفعات المنتظرة"
          description={
            salesEnabled ? "طلبات دفع مرسلة، وأرصدة بانتظار الدفع، ومسودات" : "البيع مطفأ: الدفعات مسودات فقط"
          }
        >
          {pending.length === 0 && overview.awaitingBalance.length === 0 ? (
            <EmptyState>لا دفعات منتظرة.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {overview.overdueDeposits.map((d) => (
                <li key={`late-${d.milestoneId}`} className="flex items-center justify-between gap-3 py-2.5">
                  <Link href={`${projectHref(d.projectId)}#payments`} className="min-w-0 truncate hover:text-brand">
                    <Ltr className="text-xs text-muted">{projectById.get(d.projectId)?.ref}</Ltr> · دفعة مقدمة متأخرة
                    أكثر من 48 ساعة
                  </Link>
                  <Money minor={d.amountMinor} currency={d.currency} className="text-danger" />
                </li>
              ))}
              {overview.awaitingBalance.map((p) => (
                <li key={`bal-${p.id}`} className="flex items-center justify-between gap-3 py-2.5">
                  <Link href={`${projectHref(p.id)}#payments`} className="min-w-0 truncate hover:text-brand">
                    <Ltr className="text-xs text-muted">{p.ref}</Ltr> · {p.title}
                  </Link>
                  <Badge tone="warning">بانتظار الرصيد</Badge>
                </li>
              ))}
              {[...sentPayments, ...draftPayments].map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                  <Link href={`${projectHref(m.projectId)}#payments`} className="min-w-0 truncate hover:text-brand">
                    <Ltr className="text-xs text-muted">{m.projectRef}</Ltr> ·{" "}
                    {m.label ?? MILESTONE_KIND_LABELS[m.kind].ar}
                  </Link>
                  <span className="flex shrink-0 items-center gap-2">
                    <Money minor={m.amountMinor} currency={m.currency} />
                    <Badge tone={milestoneTone(m.status)}>{MILESTONE_STATUS_LABELS[m.status].ar}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="آخر الأحداث">
          {recent.length === 0 ? (
            <EmptyState>لا أحداث بعد.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((e) => (
                <li key={e.id} className="py-2.5">
                  <Link href={`${projectHref(e.projectId)}#timeline`} className="block hover:text-brand">
                    <span className="text-sm">{eventTitleAr(e)}</span>
                  </Link>
                  <p className="mt-0.5 text-xs text-muted">
                    <Ltr>{e.projectRef}</Ltr> · {ACTOR_LABELS_AR[e.actor]} · {formatDateTime(e.createdAt)}
                    {e.visibleToClient && " · يراه العميل"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="تجديدات خلال 14 يومًا" description="اشتراكات ودومينات وسيرفرات">
          {overview.renewals.length === 0 ? (
            <EmptyState>لا تجديدات قريبة.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {overview.renewals.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0 truncate">
                    {c.vendor} <span className="text-xs text-muted">· {COST_CATEGORY_LABELS_AR[c.category]}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-sm">
                    <Money minor={c.amountMinor} currency={c.currency} />
                    <span className="text-xs text-muted">{formatDate(c.renewsOn)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="المشاريع حسب الحالة">
          <div className="flex flex-wrap gap-2">
            {PROJECT_STATUSES.filter((s) => counts.get(s)).map((s) => (
              <Link
                key={s}
                href={`/admin/projects?status=${s}`}
                className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-sm hover:border-brand"
              >
                {STATUS_LABELS_AR[s]} <span className="font-bold tabular-nums">{counts.get(s)}</span>
              </Link>
            ))}
            {counts.size === 0 && <EmptyState>لا مشاريع بعد.</EmptyState>}
          </div>
        </Card>
      </div>
    </>
  );
}
