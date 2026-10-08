import type { Metadata } from "next";
import Link from "next/link";
import { Ltr, PageHeader } from "@/components/ui";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/next-session";
import { listProjectMagicLinks } from "@/lib/magic-links";
import { canReleaseFinalDeliverables } from "@/lib/payment-plan";
import { allowedTransitions, checkTransitionGuard, clientView } from "@/lib/project-status";
import { getSalesConfig } from "@/lib/sales";
import { listChangeRequests } from "@/lib/services/change-requests";
import { listDeliverables } from "@/lib/services/deliverables";
import { listProjectDocuments } from "@/lib/services/documents";
import { listMilestones } from "@/lib/services/payments";
import {
  countOpenChangeRequests,
  getClient,
  getProject,
  listProjectEvents,
  loadTransitionFacts,
} from "@/lib/services/projects";
import { listProjectQuotes } from "@/lib/services/quotes";
import { assertUuid, orNotFound } from "@/lib/ui/not-found";
import {
  ChangeRequestsSection,
  DeliverablesSection,
  DetailsSection,
  DocumentsSection,
  LinksSection,
  PaymentsSection,
  QuotesSection,
  StatusSection,
  TimelineSection,
} from "../../../_components/project-sections";
import { StatusBadge } from "../../../_components/status";

export const metadata: Metadata = { title: "المشروع" };

const SECTIONS = [
  ["#status", "الحالة"],
  ["#quotes", "العروض"],
  ["#payments", "الدفعات"],
  ["#documents", "المستندات"],
  ["#deliverables", "التسليمات"],
  ["#change-requests", "طلبات التغيير"],
  ["#timeline", "الخط الزمني"],
  ["#links", "رابط العميل"],
] as const;

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  assertUuid(id);
  const db = getDb();
  const project = await orNotFound(getProject(db, id));

  const [client, events, quotes, milestones, documents, deliverables, changeRequests, links, facts, openCrs] =
    await Promise.all([
      getClient(db, project.clientId),
      listProjectEvents(db, id),
      listProjectQuotes(db, id),
      listMilestones(db, id),
      listProjectDocuments(db, id),
      listDeliverables(db, id),
      listChangeRequests(db, id),
      listProjectMagicLinks(db, id),
      loadTransitionFacts(db, id),
      countOpenChangeRequests(db, id),
    ]);

  const { salesEnabled } = getSalesConfig();
  const view = clientView(project.status, { sideFrom: project.sideFromStatus, openChangeRequests: openCrs });
  const options = allowedTransitions(project.status, { sideFrom: project.sideFromStatus }).map((to) => ({
    to,
    blockedBy: checkTransitionGuard(to, facts),
  }));

  return (
    <>
      <PageHeader
        title={project.title}
        back={{ href: "/admin/projects", label: "المشاريع" }}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Ltr>{project.ref}</Ltr>·
            <Link href={`/admin/clients/${client.id}`} className="hover:text-brand">
              {client.name}
              {client.companyName && ` (${client.companyName})`}
            </Link>
            <StatusBadge status={project.status} />
          </span>
        }
      />

      <nav aria-label="أقسام المشروع" className="-mx-4 mb-6 overflow-x-auto px-4">
        <ul className="flex gap-2">
          {SECTIONS.map(([href, label]) => (
            <li key={href}>
              <a
                href={href}
                className="block whitespace-nowrap rounded-full border border-border bg-white px-3 py-1 text-sm hover:border-brand"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <StatusSection project={project} view={view} options={options} />
          <QuotesSection project={project} quotes={quotes} documents={documents} />
          <PaymentsSection
            project={project}
            quotes={quotes}
            milestones={milestones}
            documents={documents}
            salesEnabled={salesEnabled}
          />
          <DocumentsSection project={project} documents={documents} />
          <DeliverablesSection
            project={project}
            deliverables={deliverables}
            allPaid={canReleaseFinalDeliverables(milestones)}
          />
          <ChangeRequestsSection project={project} requests={changeRequests} />
          <TimelineSection project={project} events={events} />
        </div>
        <div className="min-w-0 space-y-6">
          <LinksSection project={project} client={client} links={links} />
          <DetailsSection project={project} client={client} />
        </div>
      </div>
    </>
  );
}
