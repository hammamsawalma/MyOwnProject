import type { Metadata } from "next";
import Link from "next/link";
import { Card, DescriptionList, EmptyState, Ltr, Money, PageHeader, TableWrap, td, th } from "@/components/ui";
import { getDb } from "@/db/client";
import { AR_NOUNS, arCount } from "@/lib/plural";
import { requireAdmin } from "@/lib/auth/next-session";
import { listProjects } from "@/lib/services/admin-queries";
import { getClient } from "@/lib/services/projects";
import { formatDate } from "@/lib/ui/format";
import { CLIENT_TYPE_LABELS_AR, LANGUAGE_LABELS_AR, countryName } from "@/lib/ui/labels";
import { assertUuid, orNotFound } from "@/lib/ui/not-found";
import { updateClientAction } from "../../../_actions/clients";
import { ClientForm } from "../../../_components/client-form";
import { ProjectForm } from "../../../_components/project-form";
import { StatusBadge } from "../../../_components/status";

export const metadata: Metadata = { title: "العميل" };

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  assertUuid(id);
  const db = getDb();
  const client = await orNotFound(getClient(db, id));
  const projects = await listProjects(db, { clientId: id });

  return (
    <>
      <PageHeader
        title={client.name}
        subtitle={client.companyName ?? CLIENT_TYPE_LABELS_AR[client.type]}
        back={{ href: "/admin/clients", label: "العملاء" }}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card title="المشاريع" description={arCount(projects.length, AR_NOUNS.project)}>
            {projects.length === 0 ? (
              <EmptyState>لا مشاريع لهذا العميل بعد.</EmptyState>
            ) : (
              <TableWrap>
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr>
                      <th className={th}>المشروع</th>
                      <th className={th}>الحالة</th>
                      <th className={th}>القيمة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((p) => (
                      <tr key={p.id}>
                        <td className={td}>
                          <Link href={`/admin/projects/${p.id}`} className="font-medium text-brand hover:underline">
                            <bdi>{p.title}</bdi>
                          </Link>
                          <p className="text-xs text-muted">
                            <Ltr>{p.ref}</Ltr>
                          </p>
                        </td>
                        <td className={td}>
                          <StatusBadge status={p.status} />
                        </td>
                        <td className={td}>
                          {p.priceTotalMinor !== null ? <Money minor={p.priceTotalMinor} currency={p.currency} /> : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
          <Card title="مشروع جديد لهذا العميل">
            <ProjectForm clients={[{ id: client.id, label: client.name }]} defaultClientId={client.id} />
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card title="البيانات">
            <DescriptionList
              items={[
                { label: "البريد", value: client.email ? <Ltr>{client.email}</Ltr> : "—" },
                { label: "الهاتف", value: client.phoneE164 ? <Ltr>{client.phoneE164}</Ltr> : "—" },
                { label: "البلد", value: countryName(client.country) },
                { label: "اللغة", value: LANGUAGE_LABELS_AR[client.language] },
                { label: "الرقم الضريبي", value: client.taxId ? <Ltr>{client.taxId}</Ltr> : "—" },
                { label: "الشريحة", value: client.segment ?? "—" },
                { label: "المصدر", value: client.source ?? "—" },
                { label: "أضيف في", value: formatDate(client.createdAt) },
              ]}
            />
            {client.notes && (
              <p className="mt-4 whitespace-pre-line rounded-lg bg-surface p-3 text-sm">{client.notes}</p>
            )}
          </Card>
          <Card title="تعديل البيانات">
            <ClientForm
              action={updateClientAction.bind(null, client.id)}
              values={{
                name: client.name,
                type: client.type,
                companyName: client.companyName,
                email: client.email,
                phoneE164: client.phoneE164,
                country: client.country,
                language: client.language,
                taxId: client.taxId,
                segment: client.segment,
                source: client.source,
                notes: client.notes,
              }}
              submitLabel="حفظ التعديلات"
            />
          </Card>
        </div>
      </div>
    </>
  );
}
