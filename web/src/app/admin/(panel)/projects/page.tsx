import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink, Card, EmptyState, Ltr, Money, PageHeader, TableWrap, cx, td, th } from "@/components/ui";
import { getDb } from "@/db/client";
import { AR_NOUNS, arCount } from "@/lib/plural";
import { requireAdmin } from "@/lib/auth/next-session";
import { isProjectStatus, MAIN_STATUSES, SIDE_STATUSES, STATUS_LABELS_AR } from "@/lib/project-status";
import { listProjects, type ProjectListFilter } from "@/lib/services/admin-queries";
import { formatDate } from "@/lib/ui/format";
import { clientStageText, StatusBadge } from "../../_components/status";

export const metadata: Metadata = { title: "المشاريع" };

const GROUPS: { value: ProjectListFilter; label: string }[] = [
  { value: "active", label: "النشطة" },
  { value: "all", label: "الكل" },
  { value: "side", label: "معلّقة / ملغاة / خسرناها / نزاع" },
];

function parseFilter(value: string | undefined): ProjectListFilter {
  if (value === "all" || value === "side" || value === "active") return value;
  if (value && isProjectStatus(value)) return value;
  return "active";
}

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdmin();
  const filter = parseFilter((await searchParams).status);
  const rows = await listProjects(getDb(), { status: filter });

  const chip = (value: string, label: string) => (
    <Link
      key={value}
      href={`/admin/projects?status=${value}`}
      aria-current={filter === value ? "true" : undefined}
      className={cx(
        "whitespace-nowrap rounded-full border px-3 py-1 text-sm",
        filter === value ? "border-brand bg-brand text-brand-foreground" : "border-border bg-white hover:border-brand",
      )}
    >
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="المشاريع"
        subtitle={arCount(rows.length, AR_NOUNS.project)}
        actions={<ButtonLink href="/admin/projects/new">مشروع جديد</ButtonLink>}
      />
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">{GROUPS.map((g) => chip(g.value, g.label))}</div>
        <form className="mb-4 flex flex-wrap items-center gap-2">
          <label htmlFor="status" className="text-sm text-muted">
            حالة محددة:
          </label>
          <select
            id="status"
            name="status"
            defaultValue={isProjectStatus(filter) ? filter : ""}
            className="h-9 rounded-lg border border-border bg-white px-2 text-sm"
          >
            <option value="" disabled>
              اختر…
            </option>
            <optgroup label="المسار الرئيسي">
              {MAIN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS_AR[s]}
                </option>
              ))}
            </optgroup>
            <optgroup label="حالات جانبية">
              {SIDE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS_AR[s]}
                </option>
              ))}
            </optgroup>
          </select>
          <button type="submit" className="h-9 rounded-lg border border-border bg-white px-3 text-sm hover:bg-surface">
            عرض
          </button>
        </form>

        {rows.length === 0 ? (
          <EmptyState>لا مشاريع في هذا التصنيف.</EmptyState>
        ) : (
          <TableWrap>
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr>
                  <th className={th}>المشروع</th>
                  <th className={th}>العميل</th>
                  <th className={th}>الحالة الداخلية</th>
                  <th className={th}>ما يراه العميل</th>
                  <th className={th}>القيمة</th>
                  <th className={th}>الموعد</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-surface/60">
                    <td className={td}>
                      <Link href={`/admin/projects/${p.id}`} className="font-medium text-brand hover:underline">
                        <bdi>{p.title}</bdi>
                      </Link>
                      <p className="text-xs text-muted">
                        <Ltr>{p.ref}</Ltr>
                      </p>
                    </td>
                    <td className={td}>
                      <Link href={`/admin/clients/${p.clientId}`} className="hover:text-brand">
                        {p.clientName}
                      </Link>
                      {p.clientCompany && <p className="text-xs text-muted">{p.clientCompany}</p>}
                    </td>
                    <td className={td}>
                      <StatusBadge status={p.status} />
                    </td>
                    <td className={`${td} text-muted`}>{clientStageText(p.status, p.sideFromStatus)}</td>
                    <td className={td}>
                      {p.priceTotalMinor !== null ? <Money minor={p.priceTotalMinor} currency={p.currency} /> : "—"}
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{formatDate(p.dueAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
