import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  listClientsWithCounts,
  listPendingPayments,
  listProjects,
  listRecentEvents,
} from "@/lib/services/admin-queries";
import { createMilestone } from "@/lib/services/payments";
import { clientTimelineMessage, getClientPortalView, sendPortalLink } from "@/lib/services/portal";
import {
  addManualEvent,
  addProjectEvent,
  createClient,
  createProject,
  listProjectEvents,
  setEventVisibility,
  transitionProject,
  updateClient,
  updateProjectDetails,
} from "@/lib/services/projects";
import { emailOutbox } from "@/db/schema";
import { desc } from "drizzle-orm";
import { openTestDb, resetDatabase } from "./helpers";

const handle = openTestDb();
const { db } = handle;

beforeEach(() => resetDatabase(handle));
afterAll(() => handle.close());

async function setup(language: "ar" | "en" = "ar") {
  const client = await createClient(db, { name: "سارة", email: "sara@example.com", language });
  const project = await createProject(db, { clientId: client.id, title: "لوحة بيانات" });
  return { client, project };
}

describe("admin UI services", () => {
  it("updates clients and project details", async () => {
    const { client, project } = await setup();
    const updated = await updateClient(db, client.id, { name: "سارة أحمد", email: "SARA@Example.com", country: "AE" });
    expect(updated).toMatchObject({ name: "سارة أحمد", email: "sara@example.com", country: "AE" });

    const due = new Date("2026-12-01T09:00:00Z");
    const details = await updateProjectDetails(db, project.id, {
      title: "لوحة بيانات المبيعات",
      dueAt: due,
      assignedMachine: " mac-2 ",
      assignedPerson: "",
    });
    expect(details).toMatchObject({ title: "لوحة بيانات المبيعات", assignedMachine: "mac-2", assignedPerson: null });
    expect(details.dueAt?.toISOString()).toBe(due.toISOString());
  });

  it("toggles event visibility only within the project", async () => {
    const { project } = await setup();
    const other = await setup();
    const event = await addProjectEvent(db, {
      projectId: project.id,
      type: "status_changed",
      actor: "admin",
      fromStatus: "lead",
      toStatus: "qualified",
    });
    const shown = await setEventVisibility(db, { projectId: project.id, eventId: event.id, visible: true });
    expect(shown.visibleToClient).toBe(true);
    await expect(
      setEventVisibility(db, { projectId: other.project.id, eventId: event.id, visible: false }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("shows client updates to the client and keeps internal notes private", async () => {
    const { project } = await setup();
    await addManualEvent(db, { projectId: project.id, text: "بدأنا تجهيز البيانات", visibleToClient: true });
    await addManualEvent(db, { projectId: project.id, text: "internal: client is slow", visibleToClient: false });
    await expect(
      addManualEvent(db, { projectId: project.id, text: "  ", visibleToClient: true }),
    ).rejects.toMatchObject({
      code: "invalid_input",
    });

    const events = await listProjectEvents(db, project.id);
    const note = events.find((e) => e.type === "note");
    expect(note).toMatchObject({ visibleToClient: false, note: "internal: client is slow" });
    expect(clientTimelineMessage(note!)).toBeNull();

    const view = await getClientPortalView(db, project.id);
    const json = JSON.stringify(view);
    expect(json).toContain("بدأنا تجهيز البيانات");
    expect(json).not.toContain("client is slow");

    // Even a note wrongly marked visible has no client wording, so it never shows.
    await setEventVisibility(db, { projectId: project.id, eventId: note!.id, visible: true });
    expect(JSON.stringify(await getClientPortalView(db, project.id))).not.toContain("client is slow");
  });

  it("hides draft milestones that are not part of an accepted quote", async () => {
    const { project } = await setup();
    await createMilestone(db, { projectId: project.id, kind: "deposit", amountMinor: 10_000, currency: "USD" });
    const view = await getClientPortalView(db, project.id);
    expect(view.payments).toHaveLength(0);
    const pending = await listPendingPayments(db);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ projectRef: project.ref, status: "draft" });
  });

  it("lists clients, projects by filter and recent events", async () => {
    const { client, project } = await setup();
    const second = await createProject(db, { clientId: client.id, title: "بوت واتساب" });
    await transitionProject(db, { projectId: second.id, to: "lost", actor: "admin", note: "budget" });

    const clients = await listClientsWithCounts(db, { q: "sara@" });
    expect(clients).toHaveLength(1);
    expect(clients[0]?.projectCount).toBe(2);
    expect(await listClientsWithCounts(db, { q: "nobody" })).toHaveLength(0);

    expect((await listProjects(db, { status: "active" })).map((p) => p.id)).toEqual([project.id]);
    expect((await listProjects(db, { status: "side" })).map((p) => p.id)).toEqual([second.id]);
    expect((await listProjects(db, { status: "lead" })).map((p) => p.id)).toEqual([project.id]);
    expect(await listProjects(db, { clientId: client.id })).toHaveLength(2);

    const recent = await listRecentEvents(db, 2);
    expect(recent[0]).toMatchObject({ projectRef: second.ref, type: "status_changed", toStatus: "lost" });
  });

  it("emails English-speaking clients the English view of the tracking page", async () => {
    const { project } = await setup("en");
    const link = await sendPortalLink(db, { projectId: project.id });
    const [mail] = await db.select().from(emailOutbox).orderBy(desc(emailOutbox.createdAt)).limit(1);
    expect(mail?.textBody).toContain(`${link.url}?lang=en`);
  });
});
