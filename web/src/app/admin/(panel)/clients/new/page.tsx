import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/next-session";
import { createClientAction } from "../../../_actions/clients";
import { ClientForm } from "../../../_components/client-form";

export const metadata: Metadata = { title: "عميل جديد" };

export default async function NewClientPage() {
  await requireAdmin();
  return (
    <>
      <PageHeader title="عميل جديد" back={{ href: "/admin/clients", label: "العملاء" }} />
      <Card>
        <ClientForm action={createClientAction} submitLabel="إضافة العميل" />
      </Card>
    </>
  );
}
