import { and, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { changeRequests, clients, paymentMilestones, projectEvents, projects, quotes } from "@/db/schema";
import { CLIENT_TYPES, LANGUAGES, PACKAGE_TIERS, PRICING_MODELS, type EventActor } from "@/lib/domain-enums";
import { NotFoundError } from "@/lib/errors";
import { CURRENCIES } from "@/lib/money";
import { allocateNumber, NUMBER_SERIES } from "@/lib/numbering";
import { canReleaseFinalDeliverables } from "@/lib/payment-plan";
import {
  canTransition,
  checkTransitionGuard,
  clientView,
  isClientVisibleChange,
  nextSideFrom,
  TransitionError,
  type ClientView,
  type ProjectStatus,
  type TransitionFacts,
} from "@/lib/project-status";
import { releaseFinalDeliverablesInTx } from "./deliverables";

export type ProjectRow = typeof projects.$inferSelect;
export type ClientRow = typeof clients.$inferSelect;
export type ProjectEventRow = typeof projectEvents.$inferSelect;

const blankToNull = (v: string | null | undefined) => (v && v.trim() !== "" ? v.trim() : null);

export const CreateClientInput = z.object({
  name: z.string().trim().min(1),
  type: z.enum(CLIENT_TYPES).default("individual"),
  companyName: z.string().nullish(),
  email: z.email().nullish(),
  phoneE164: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/)
    .nullish(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullish(),
  language: z.enum(LANGUAGES).default("ar"),
  taxId: z.string().nullish(),
  segment: z.string().nullish(),
  source: z.string().nullish(),
  notes: z.string().nullish(),
});

export async function createClient(db: Db, input: z.input<typeof CreateClientInput>): Promise<ClientRow> {
  const data = CreateClientInput.parse(input);
  const [row] = await db
    .insert(clients)
    .values({
      ...data,
      companyName: blankToNull(data.companyName),
      email: data.email ? data.email.toLowerCase() : null,
      phoneE164: data.phoneE164 ?? null,
      country: data.country ?? null,
      taxId: blankToNull(data.taxId),
      segment: blankToNull(data.segment),
      source: blankToNull(data.source),
      notes: blankToNull(data.notes),
    })
    .returning();
  if (!row) throw new Error("client insert failed");
  return row;
}

export const CreateProjectInput = z.object({
  clientId: z.uuid(),
  title: z.string().trim().min(1),
  serviceKey: z.string().nullish(),
  pricingModel: z.enum(PRICING_MODELS).default("custom"),
  packageTier: z.enum(PACKAGE_TIERS).nullish(),
  currency: z.enum(CURRENCIES).default("USD"),
  source: z.string().nullish(),
});

export async function createProject(
  db: Db,
  input: z.input<typeof CreateProjectInput>,
  options: { actor?: EventActor; now?: Date } = {},
): Promise<ProjectRow> {
  const data = CreateProjectInput.parse(input);
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    const { ref } = await allocateNumber(tx, NUMBER_SERIES.project, { date: now });
    const [project] = await tx
      .insert(projects)
      .values({
        ...data,
        ref,
        serviceKey: blankToNull(data.serviceKey),
        packageTier: data.packageTier ?? null,
        source: blankToNull(data.source),
        status: "lead",
        createdAt: now,
      })
      .returning();
    if (!project) throw new Error("project insert failed");
    await addProjectEvent(tx, {
      projectId: project.id,
      type: "project_created",
      actor: options.actor ?? "admin",
      visibleToClient: true,
      toStatus: "lead",
      now,
    });
    return project;
  });
}

export async function getProject(db: Db, projectId: string, options: { forUpdate?: boolean } = {}) {
  const query = db.select().from(projects).where(eq(projects.id, projectId));
  const [row] = options.forUpdate ? await query.for("update") : await query;
  if (!row) throw new NotFoundError("project", projectId);
  return row;
}

export async function getClient(db: Db, clientId: string): Promise<ClientRow> {
  const [row] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!row) throw new NotFoundError("client", clientId);
  return row;
}

export async function addProjectEvent(
  db: Db,
  input: {
    projectId: string;
    type: string;
    actor: EventActor;
    visibleToClient?: boolean;
    fromStatus?: ProjectStatus | null;
    toStatus?: ProjectStatus | null;
    note?: string | null;
    payload?: Record<string, unknown>;
    now?: Date;
  },
): Promise<ProjectEventRow> {
  const [row] = await db
    .insert(projectEvents)
    .values({
      projectId: input.projectId,
      type: input.type,
      actor: input.actor,
      visibleToClient: input.visibleToClient ?? false,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      note: input.note ?? null,
      payload: input.payload ?? {},
      createdAt: input.now ?? new Date(),
    })
    .returning();
  if (!row) throw new Error("event insert failed");
  return row;
}

export async function countOpenChangeRequests(db: Db, projectId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(changeRequests)
    .where(and(eq(changeRequests.projectId, projectId), inArray(changeRequests.status, ["open", "quoted"])));
  return row?.n ?? 0;
}

export async function loadTransitionFacts(db: Db, projectId: string): Promise<TransitionFacts> {
  const initialQuotes = await db
    .select({ status: quotes.status })
    .from(quotes)
    .where(and(eq(quotes.projectId, projectId), eq(quotes.kind, "initial")));
  const milestones = await db
    .select({ kind: paymentMilestones.kind, status: paymentMilestones.status })
    .from(paymentMilestones)
    .where(eq(paymentMilestones.projectId, projectId));

  return {
    hasSentQuote: initialQuotes.some((q) => q.status === "sent" || q.status === "accepted"),
    hasAcceptedQuote: initialQuotes.some((q) => q.status === "accepted"),
    depositPaid: milestones.some((m) => m.kind === "deposit" && m.status === "paid"),
    allMilestonesPaid: canReleaseFinalDeliverables(milestones),
  };
}

export interface TransitionResult {
  project: ProjectRow;
  event: ProjectEventRow;
  clientView: ClientView;
}

/**
 * The only way to change a project's status: validates the transition graph and
 * business guards, records a timeline event (client-visible when the client's
 * stage, flags or notice change) and applies status side effects.
 */
export async function transitionProject(
  db: Db,
  input: { projectId: string; to: ProjectStatus; actor: EventActor; note?: string | null; now?: Date },
): Promise<TransitionResult> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const project = await getProject(tx, input.projectId, { forUpdate: true });
    const from = project.status;
    const to = input.to;

    if (!canTransition(from, to, { sideFrom: project.sideFromStatus })) {
      throw new TransitionError("not_allowed", from, to);
    }
    const guard = checkTransitionGuard(to, await loadTransitionFacts(tx, project.id));
    if (guard) throw new TransitionError(guard, from, to);

    const sideFrom = nextSideFrom(from, to, project.sideFromStatus);
    const patch: Partial<typeof projects.$inferInsert> = { status: to, sideFromStatus: sideFrom, updatedAt: now };
    if (from === "client_review" && to === "revisions") patch.revisionsUsed = project.revisionsUsed + 1;
    if (to === "delivered") patch.deliveredAt = now;
    if (to === "warranty") patch.warrantyEndsAt = new Date(now.getTime() + project.warrantyDays * 86_400_000);
    if (to === "closed") patch.closedAt = now;
    if (to === "lost" && input.note) patch.lostReason = input.note;

    const [updated] = await tx.update(projects).set(patch).where(eq(projects.id, project.id)).returning();
    if (!updated) throw new Error("project update failed");

    const openChangeRequests = await countOpenChangeRequests(tx, project.id);
    const before = clientView(from, { sideFrom: project.sideFromStatus, openChangeRequests });
    const after = clientView(to, { sideFrom, openChangeRequests });

    const event = await addProjectEvent(tx, {
      projectId: project.id,
      type: "status_changed",
      actor: input.actor,
      fromStatus: from,
      toStatus: to,
      visibleToClient: isClientVisibleChange(before, after),
      note: input.note ?? null,
      payload: { clientStage: after.stage },
      now,
    });

    if (to === "delivered") await releaseFinalDeliverablesInTx(tx, project.id, now);

    return { project: updated, event, clientView: after };
  });
}

export async function listProjectEvents(db: Db, projectId: string, options: { clientOnly?: boolean } = {}) {
  const where = options.clientOnly
    ? and(eq(projectEvents.projectId, projectId), eq(projectEvents.visibleToClient, true))
    : eq(projectEvents.projectId, projectId);
  return db.select().from(projectEvents).where(where).orderBy(projectEvents.seq);
}
