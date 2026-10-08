import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { changeRequests } from "@/db/schema";
import type { ChangeRequestStatus, EventActor } from "@/lib/domain-enums";
import { DomainError, NotFoundError } from "@/lib/errors";
import { addProjectEvent } from "./projects";

export type ChangeRequestRow = typeof changeRequests.$inferSelect;

/** A client or the admin logs a request; the admin decides if it is in scope. */
export async function createChangeRequest(
  db: Db,
  input: { projectId: string; description: string; requestedBy: EventActor; now?: Date },
): Promise<ChangeRequestRow> {
  const description = input.description.trim();
  if (!description) throw new DomainError("invalid_input", "Description is required");
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(changeRequests)
      .values({ projectId: input.projectId, description, requestedBy: input.requestedBy, createdAt: now })
      .returning();
    if (!row) throw new Error("change request insert failed");
    await addProjectEvent(tx, {
      projectId: input.projectId,
      type: "change_request_created",
      actor: input.requestedBy,
      visibleToClient: true,
      payload: { changeRequestId: row.id },
      now,
    });
    return row;
  });
}

/** in scope = handled as a revision; out of scope = needs an add-on quote. */
export async function assessChangeRequest(db: Db, id: string, inScope: boolean): Promise<ChangeRequestRow> {
  const [row] = await db
    .update(changeRequests)
    .set({ inScope, updatedAt: new Date() })
    .where(eq(changeRequests.id, id))
    .returning();
  if (!row) throw new NotFoundError("change request", id);
  return row;
}

export async function resolveChangeRequest(
  db: Db,
  id: string,
  status: Extract<ChangeRequestStatus, "declined" | "done" | "cancelled">,
  now: Date = new Date(),
): Promise<ChangeRequestRow> {
  const [row] = await db
    .update(changeRequests)
    .set({ status, resolvedAt: now, updatedAt: now })
    .where(eq(changeRequests.id, id))
    .returning();
  if (!row) throw new NotFoundError("change request", id);
  return row;
}

export async function listChangeRequests(db: Db, projectId: string, status?: ChangeRequestStatus) {
  const where = status
    ? and(eq(changeRequests.projectId, projectId), eq(changeRequests.status, status))
    : eq(changeRequests.projectId, projectId);
  return db.select().from(changeRequests).where(where).orderBy(changeRequests.createdAt);
}
