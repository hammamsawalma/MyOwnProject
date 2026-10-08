import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Ltr, Notice, PageHeader } from "@/components/ui";
import { policy } from "@/config/policy";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/next-session";
import { listChangeRequests } from "@/lib/services/change-requests";
import { getProject } from "@/lib/services/projects";
import { getQuoteWithLines, listProjectQuotes } from "@/lib/services/quotes";
import { getPaymentPolicy } from "@/lib/settings";
import { assertUuid, orNotFound } from "@/lib/ui/not-found";
import { saveQuoteDraftAction } from "../../../../../_actions/quotes";
import { QuoteBuilder } from "../../../../../_components/quote-builder";
import { blankDefaults, defaultsFromQuote } from "../../../../../_components/quote-defaults";

export const metadata: Metadata = { title: "عرض سعر جديد" };

export default async function NewQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ kind?: string; changeRequestId?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  assertUuid(id);
  const query = await searchParams;
  const kind = query.kind === "addon" ? "addon" : "initial";
  const db = getDb();
  const project = await orNotFound(getProject(db, id));
  const changeRequest =
    kind === "addon" && query.changeRequestId
      ? (await listChangeRequests(db, id)).find((c) => c.id === query.changeRequestId)
      : undefined;

  // A new initial version starts from the latest initial quote (renegotiation).
  const previous =
    kind === "initial" ? (await listProjectQuotes(db, id)).filter((q) => q.kind === "initial").at(-1) : undefined;
  // One open draft at a time: continue editing it instead of creating another.
  if (previous?.status === "draft") redirect(`/admin/projects/${id}/quotes/${previous.id}`);
  const defaults = previous
    ? defaultsFromQuote(previous, (await getQuoteWithLines(db, previous.id)).lineItems, false)
    : blankDefaults(project, kind, changeRequest);

  return (
    <>
      <PageHeader
        title={kind === "addon" ? "عرض إضافة جديد" : previous ? "نسخة جديدة من عرض السعر" : "عرض سعر جديد"}
        subtitle={
          <>
            {project.title} · <Ltr>{project.ref}</Ltr>
          </>
        }
        back={{ href: `/admin/projects/${id}#quotes`, label: "المشروع" }}
      />
      {previous && (
        <Notice className="mb-6">
          البيانات منسوخة من آخر عرض (<Ltr>{previous.ref ?? "مسودة"}</Ltr>). إصدار النسخة الجديدة يستبدل العرض المرسل السابق.
        </Notice>
      )}
      <QuoteBuilder
        action={saveQuoteDraftAction.bind(null, id, null)}
        defaults={defaults}
        policy={await getPaymentPolicy(db)}
        termsVersion={policy.termsVersion}
        validityDays={policy.quoteValidityDays}
      />
    </>
  );
}
