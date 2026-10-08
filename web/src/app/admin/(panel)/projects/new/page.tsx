import type { Metadata } from "next";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/next-session";
import { listClientsWithCounts } from "@/lib/services/admin-queries";
import { ProjectForm } from "../../../_components/project-form";

export const metadata: Metadata = { title: "مشروع جديد" };

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ clientId?: string }> }) {
  await requireAdmin();
  const { clientId } = await searchParams;
  const clients = await listClientsWithCounts(getDb());

  return (
    <>
      <PageHeader title="مشروع جديد" back={{ href: "/admin/projects", label: "المشاريع" }} />
      <Card>
        {clients.length === 0 ? (
          <div className="space-y-3">
            <EmptyState>أضف العميل أولًا، ثم أنشئ مشروعه.</EmptyState>
            <ButtonLink href="/admin/clients/new">عميل جديد</ButtonLink>
          </div>
        ) : (
          <ProjectForm
            clients={clients.map((c) => ({ id: c.id, label: c.companyName ? `${c.name} · ${c.companyName}` : c.name }))}
            defaultClientId={clients.some((c) => c.id === clientId) ? clientId : undefined}
          />
        )}
      </Card>
    </>
  );
}
