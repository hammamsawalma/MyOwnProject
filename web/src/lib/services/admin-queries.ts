import { and, count, desc, eq, ilike, inArray, notInArray, or, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { clients, paymentMilestones, projectEvents, projects } from "@/db/schema";
import { SIDE_STATUSES, type ProjectStatus } from "@/lib/project-status";

/** Read-only queries for the admin screens (lists and overviews). */

export async function listClientsWithCounts(db: Db, filter: { q?: string } = {}) {
  const q = filter.q?.trim();
  const where = q
    ? or(ilike(clients.name, `%${q}%`), ilike(clients.companyName, `%${q}%`), ilike(clients.email, `%${q}%`))
    : undefined;
  return db
    .select({
      id: clients.id,
      name: clients.name,
      type: clients.type,
      companyName: clients.companyName,
      email: clients.email,
      country: clients.country,
      language: clients.language,
      createdAt: clients.createdAt,
      projectCount: count(projects.id),
    })
    .from(clients)
    .leftJoin(projects, eq(projects.clientId, clients.id))
    .where(where)
    .groupBy(clients.id)
    .orderBy(desc(clients.createdAt));
}

export type ProjectListFilter = ProjectStatus | "active" | "side" | "all";

const ENDED: ProjectStatus[] = ["closed", "follow_up", ...SIDE_STATUSES];

export async function listProjects(db: Db, filter: { status?: ProjectListFilter; clientId?: string } = {}) {
  const conditions: SQL[] = [];
  const status = filter.status ?? "all";
  if (status === "active") conditions.push(notInArray(projects.status, ENDED));
  else if (status === "side") conditions.push(inArray(projects.status, [...SIDE_STATUSES]));
  else if (status !== "all") conditions.push(eq(projects.status, status));
  if (filter.clientId) conditions.push(eq(projects.clientId, filter.clientId));

  return db
    .select({
      id: projects.id,
      ref: projects.ref,
      title: projects.title,
      status: projects.status,
      sideFromStatus: projects.sideFromStatus,
      currency: projects.currency,
      priceTotalMinor: projects.priceTotalMinor,
      dueAt: projects.dueAt,
      updatedAt: projects.updatedAt,
      clientId: clients.id,
      clientName: clients.name,
      clientCompany: clients.companyName,
    })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(projects.updatedAt));
}

export async function listRecentEvents(db: Db, limit = 15) {
  return db
    .select({
      id: projectEvents.id,
      type: projectEvents.type,
      fromStatus: projectEvents.fromStatus,
      toStatus: projectEvents.toStatus,
      actor: projectEvents.actor,
      visibleToClient: projectEvents.visibleToClient,
      createdAt: projectEvents.createdAt,
      projectId: projects.id,
      projectRef: projects.ref,
      projectTitle: projects.title,
    })
    .from(projectEvents)
    .innerJoin(projects, eq(projects.id, projectEvents.projectId))
    .orderBy(desc(projectEvents.seq))
    .limit(limit);
}

/** Milestones not yet paid (drafts and sent requests), oldest request first. */
export async function listPendingPayments(db: Db) {
  return db
    .select({
      id: paymentMilestones.id,
      kind: paymentMilestones.kind,
      label: paymentMilestones.label,
      amountMinor: paymentMilestones.amountMinor,
      currency: paymentMilestones.currency,
      status: paymentMilestones.status,
      sentAt: paymentMilestones.sentAt,
      createdAt: paymentMilestones.createdAt,
      projectId: projects.id,
      projectRef: projects.ref,
      projectTitle: projects.title,
      projectStatus: projects.status,
    })
    .from(paymentMilestones)
    .innerJoin(projects, eq(projects.id, paymentMilestones.projectId))
    .where(inArray(paymentMilestones.status, ["draft", "sent"]))
    .orderBy(desc(paymentMilestones.status), paymentMilestones.sentAt, paymentMilestones.createdAt);
}
