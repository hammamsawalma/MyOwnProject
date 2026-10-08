"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/next-session";
import { DELIVERABLE_KINDS, EVENT_ACTORS } from "@/lib/domain-enums";
import { DomainError } from "@/lib/errors";
import { createMagicLink, listProjectMagicLinks, revokeMagicLink } from "@/lib/magic-links";
import { isProjectStatus } from "@/lib/project-status";
import {
  assessChangeRequest,
  createChangeRequest,
  listChangeRequests,
  resolveChangeRequest,
} from "@/lib/services/change-requests";
import { addDeliverable, releaseFinalDeliverables } from "@/lib/services/deliverables";
import { sendPortalLink } from "@/lib/services/portal";
import {
  addManualEvent,
  addProjectEvent,
  getProject,
  setEventVisibility,
  transitionProject,
  updateProjectDetails,
} from "@/lib/services/projects";
import type { ActionState } from "@/lib/ui/action-state";
import { runAction } from "@/lib/ui/errors";
import { parseDateInput } from "@/lib/ui/format";
import { bool, file, oneOf, optStr, str } from "@/lib/ui/form";

const projectPath = (projectId: string) => `/admin/projects/${projectId}`;

export async function transitionAction(projectId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  return runAction(async () => {
    const to = str(fd, "to");
    if (!isProjectStatus(to)) throw new DomainError("invalid_input", "Unknown status");
    await transitionProject(getDb(), { projectId, to, actor: "admin", note: optStr(fd, "note") });
    revalidatePath(projectPath(projectId));
    return { status: "ok", message: "تم تغيير الحالة." };
  });
}

export async function updateProjectDetailsAction(
  projectId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  await requireAdmin();
  return runAction(async () => {
    const due = str(fd, "dueAt");
    await updateProjectDetails(getDb(), projectId, {
      title: str(fd, "title"),
      serviceKey: optStr(fd, "serviceKey"),
      dueAt: due ? parseDateInput(due) : null,
      assignedMachine: optStr(fd, "assignedMachine"),
      assignedPerson: optStr(fd, "assignedPerson"),
    });
    revalidatePath(projectPath(projectId));
    return { status: "ok", message: "حُفظت بيانات المشروع." };
  });
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export async function addEventAction(projectId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  return runAction(async () => {
    const visible = bool(fd, "visibleToClient");
    await addManualEvent(getDb(), { projectId, text: str(fd, "text"), visibleToClient: visible });
    revalidatePath(projectPath(projectId));
    return { status: "ok", message: visible ? "أُضيفت الرسالة وستظهر للعميل." : "أُضيفت الملاحظة الداخلية." };
  });
}

export async function toggleEventVisibilityAction(
  projectId: string,
  eventId: string,
  visible: boolean,
): Promise<ActionState> {
  await requireAdmin();
  return runAction(async () => {
    await setEventVisibility(getDb(), { projectId, eventId, visible });
    revalidatePath(projectPath(projectId));
  });
}

// ---------------------------------------------------------------------------
// Magic links
// ---------------------------------------------------------------------------

export async function createMagicLinkAction(projectId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  return runAction(async () => {
    const db = getDb();
    await getProject(db, projectId);
    const revokeExisting = bool(fd, "revokeExisting");
    const link = await createMagicLink(db, { projectId, revokeExisting });
    await addProjectEvent(db, {
      projectId,
      type: "magic_link_created",
      actor: "admin",
      payload: { linkId: link.id, revokedOthers: revokeExisting },
    });
    revalidatePath(projectPath(projectId));
    return {
      status: "ok",
      message: "انسخ الرابط الآن: لا يُحفظ في النظام ولا يمكن عرضه مرة أخرى.",
      data: { url: link.url },
    };
  });
}

export async function emailMagicLinkAction(projectId: string): Promise<ActionState> {
  await requireAdmin();
  return runAction(async () => {
    const db = getDb();
    const link = await sendPortalLink(db, { projectId });
    await addProjectEvent(db, {
      projectId,
      type: "magic_link_created",
      actor: "admin",
      payload: { linkId: link.id, revokedOthers: true, emailed: true },
    });
    revalidatePath(projectPath(projectId));
    return { status: "ok", message: "أُرسل رابط جديد إلى بريد العميل، وأُلغيت الروابط السابقة." };
  });
}

export async function revokeMagicLinkAction(projectId: string, linkId: string): Promise<ActionState> {
  await requireAdmin();
  return runAction(async () => {
    const db = getDb();
    const links = await listProjectMagicLinks(db, projectId);
    if (!links.some((l) => l.id === linkId)) throw new DomainError("not_found", "Link not in project");
    await revokeMagicLink(db, linkId);
    await addProjectEvent(db, { projectId, type: "magic_link_revoked", actor: "admin", payload: { linkId } });
    revalidatePath(projectPath(projectId));
    return { status: "ok", message: "أُلغي الرابط." };
  });
}

// ---------------------------------------------------------------------------
// Change requests
// ---------------------------------------------------------------------------

async function assertChangeRequestInProject(projectId: string, changeRequestId: string) {
  const all = await listChangeRequests(getDb(), projectId);
  if (!all.some((c) => c.id === changeRequestId)) throw new DomainError("not_found", "Change request not in project");
}

export async function createChangeRequestAction(
  projectId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  await requireAdmin();
  return runAction(async () => {
    await createChangeRequest(getDb(), {
      projectId,
      description: str(fd, "description"),
      requestedBy: oneOf(fd, "requestedBy", EVENT_ACTORS, "client"),
    });
    revalidatePath(projectPath(projectId));
    return { status: "ok", message: "سُجّل طلب التغيير." };
  });
}

export async function assessChangeRequestAction(
  projectId: string,
  changeRequestId: string,
  inScope: boolean,
): Promise<ActionState> {
  await requireAdmin();
  return runAction(async () => {
    await assertChangeRequestInProject(projectId, changeRequestId);
    await assessChangeRequest(getDb(), changeRequestId, inScope);
    revalidatePath(projectPath(projectId));
  });
}

export async function resolveChangeRequestAction(
  projectId: string,
  changeRequestId: string,
  status: "done" | "declined" | "cancelled",
): Promise<ActionState> {
  await requireAdmin();
  return runAction(async () => {
    await assertChangeRequestInProject(projectId, changeRequestId);
    await resolveChangeRequest(getDb(), changeRequestId, status);
    revalidatePath(projectPath(projectId));
  });
}

// ---------------------------------------------------------------------------
// Deliverables
// ---------------------------------------------------------------------------

export async function addDeliverableAction(projectId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  return runAction(async () => {
    const db = getDb();
    await getProject(db, projectId);
    const kind = oneOf(fd, "kind", DELIVERABLE_KINDS);
    const title = str(fd, "title");
    if (!title) throw new DomainError("invalid_input", "Title is required", { field: "title" });
    const upload = await file(fd, "file");
    const externalUrl = optStr(fd, "externalUrl") ?? undefined;
    const row = await addDeliverable(db, { projectId, kind, title, file: upload ?? undefined, externalUrl });
    await addProjectEvent(db, {
      projectId,
      type: "deliverable_added",
      actor: "admin",
      visibleToClient: kind === "preview",
      payload: { deliverableId: row.id, kind, title },
    });
    revalidatePath(projectPath(projectId));
    return {
      status: "ok",
      message:
        kind === "preview"
          ? "أُضيفت المعاينة وتظهر للعميل الآن."
          : "أُضيف التسليم النهائي (يُفتح بعد سداد كل الدفعات).",
    };
  });
}

export async function releaseFinalsAction(projectId: string): Promise<ActionState> {
  await requireAdmin();
  return runAction(async () => {
    const released = await releaseFinalDeliverables(getDb(), projectId);
    revalidatePath(projectPath(projectId));
    return { status: "ok", message: released ? `فُتح ${released} تسليم نهائي للعميل.` : "لا تسليمات نهائية مغلقة." };
  });
}
