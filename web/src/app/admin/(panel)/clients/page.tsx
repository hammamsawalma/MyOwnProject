import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink, Card, EmptyState, Input, Ltr, PageHeader, TableWrap, buttonClass, td, th } from "@/components/ui";
import { getDb } from "@/db/client";
import { AR_NOUNS, arCount } from "@/lib/plural";
import { requireAdmin } from "@/lib/auth/next-session";
import { listClientsWithCounts } from "@/lib/services/admin-queries";
import { formatDate } from "@/lib/ui/format";
import { CLIENT_TYPE_LABELS_AR, countryName } from "@/lib/ui/labels";

export const metadata: Metadata = { title: "العملاء" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAdmin();
  const { q = "" } = await searchParams;
  const rows = await listClientsWithCounts(getDb(), { q });

  return (
    <>
      <PageHeader
        title="العملاء"
        subtitle={arCount(rows.length, AR_NOUNS.client)}
        actions={<ButtonLink href="/admin/clients/new">عميل جديد</ButtonLink>}
      />
      <Card>
        <form className="mb-4 flex gap-2" role="search">
          <Input name="q" defaultValue={q} placeholder="بحث بالاسم أو الشركة أو البريد" className="max-w-sm" />
          <button type="submit" className={buttonClass("secondary")}>
            بحث
          </button>
        </form>
        {rows.length === 0 ? (
          <EmptyState>{q ? "لا نتائج." : "لا عملاء بعد. أضف أول عميل."}</EmptyState>
        ) : (
          <TableWrap>
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr>
                  <th className={th}>العميل</th>
                  <th className={th}>البريد</th>
                  <th className={th}>البلد</th>
                  <th className={th}>المشاريع</th>
                  <th className={th}>أضيف في</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="hover:bg-surface/60">
                    <td className={td}>
                      <Link href={`/admin/clients/${c.id}`} className="font-medium text-brand hover:underline">
                        <bdi>{c.name}</bdi>
                      </Link>
                      <p className="text-xs text-muted">
                        {CLIENT_TYPE_LABELS_AR[c.type]}
                        {c.companyName && (
                          <>
                            {" · "}
                            <bdi>{c.companyName}</bdi>
                          </>
                        )}
                      </p>
                    </td>
                    <td className={td}>{c.email ? <Ltr>{c.email}</Ltr> : <span className="text-muted">—</span>}</td>
                    <td className={td}>{countryName(c.country)}</td>
                    <td className={`${td} tabular-nums`}>{c.projectCount}</td>
                    <td className={`${td} whitespace-nowrap text-muted`}>{formatDate(c.createdAt)}</td>
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
