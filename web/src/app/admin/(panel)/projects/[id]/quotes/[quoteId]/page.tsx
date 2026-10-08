import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Ltr, PageHeader } from "@/components/ui";
import { policy } from "@/config/policy";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/next-session";
import { getProject } from "@/lib/services/projects";
import { getQuoteWithLines } from "@/lib/services/quotes";
import { isPolicyDefaultPlan } from "@/lib/payment-plan";
import { getPaymentPolicy } from "@/lib/settings";
import { assertUuid, orNotFound } from "@/lib/ui/not-found";
import { saveQuoteDraftAction } from "../../../../../_actions/quotes";
import { QuoteBuilder } from "../../../../../_components/quote-builder";
import { defaultsFromQuote } from "../../../../../_components/quote-defaults";

export const metadata: Metadata = { title: "تعديل مسودة العرض" };

export default async function EditQuotePage({ params }: { params: Promise<{ id: string; quoteId: string }> }) {
  await requireAdmin();
  const { id, quoteId } = await params;
  assertUuid(id);
  assertUuid(quoteId);
  const db = getDb();
  const project = await orNotFound(getProject(db, id));
  const { quote, lineItems } = await orNotFound(getQuoteWithLines(db, quoteId));
  if (quote.projectId !== id) notFound();
  // Issued quotes are immutable; changes need a new version.
  if (quote.status !== "draft") redirect(`/admin/projects/${id}#quotes`);
  const paymentPolicy = await getPaymentPolicy(db);
  // Reopen in manual mode only if the admin customised the plan; otherwise the
  // policy default is recomputed when the price changes.
  const customised = !isPolicyDefaultPlan(
    quote.paymentPlan,
    quote.totalMinor,
    paymentPolicy,
    quote.kind === "addon" ? "addon" : "project",
  );

  return (
    <>
      <PageHeader
        title={`تعديل مسودة العرض (الإصدار ${quote.version})`}
        subtitle={
          <>
            {project.title} · <Ltr>{project.ref}</Ltr>
          </>
        }
        back={{ href: `/admin/projects/${id}#quotes`, label: "المشروع" }}
      />
      <QuoteBuilder
        action={saveQuoteDraftAction.bind(null, id, quoteId)}
        defaults={defaultsFromQuote(quote, lineItems, customised)}
        policy={paymentPolicy}
        termsVersion={policy.termsVersion}
        validityDays={policy.quoteValidityDays}
      />
    </>
  );
}
