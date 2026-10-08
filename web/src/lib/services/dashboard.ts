import { and, count, eq, inArray, isNotNull, lt, sql, sum } from "drizzle-orm";
import { env } from "@/config/env";
import type { Db } from "@/db/client";
import { changeRequests, paymentMilestones, projects } from "@/db/schema";
import type { ProjectStatus } from "@/lib/project-status";
import { upcomingRenewals } from "./costs";

/** Data for the admin "Today" screen (report 07 §8.1). */

const ACTIVE_WORK: ProjectStatus[] = ["kickoff", "in_progress", "internal_qa", "revisions", "change_request"];

function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export async function getTodayOverview(db: Db, now: Date = new Date()) {
  const timeZone = env().BUSINESS_TIMEZONE;
  const today = localDate(now, timeZone);
  const month = today.slice(0, 7);

  const statusCounts = await db
    .select({ status: projects.status, n: count() })
    .from(projects)
    .groupBy(projects.status);

  const needsReply = await db
    .select({ id: projects.id, ref: projects.ref, title: projects.title, status: projects.status })
    .from(projects)
    .where(inArray(projects.status, ["lead", "qualified", "quote_draft"]))
    .orderBy(projects.createdAt);

  const openChangeRequests = await db
    .select({ id: changeRequests.id, projectId: changeRequests.projectId, description: changeRequests.description })
    .from(changeRequests)
    .where(eq(changeRequests.status, "open"));

  const overdueDeposits = await db
    .select({
      milestoneId: paymentMilestones.id,
      projectId: paymentMilestones.projectId,
      amountMinor: paymentMilestones.amountMinor,
      currency: paymentMilestones.currency,
      sentAt: paymentMilestones.sentAt,
    })
    .from(paymentMilestones)
    .where(
      and(
        eq(paymentMilestones.kind, "deposit"),
        eq(paymentMilestones.status, "sent"),
        lt(paymentMilestones.sentAt, new Date(now.getTime() - 48 * 3_600_000)),
      ),
    );

  const awaitingBalance = await db
    .select({ id: projects.id, ref: projects.ref, title: projects.title })
    .from(projects)
    .where(eq(projects.status, "awaiting_balance"));

  const lateProjects = await db
    .select({ id: projects.id, ref: projects.ref, title: projects.title, dueAt: projects.dueAt, status: projects.status })
    .from(projects)
    .where(and(inArray(projects.status, ACTIVE_WORK), isNotNull(projects.dueAt), lt(projects.dueAt, now)));

  const collectedThisMonth = await db
    .select({ currency: paymentMilestones.currency, totalMinor: sum(paymentMilestones.amountMinor).mapWith(Number) })
    .from(paymentMilestones)
    .where(
      and(
        eq(paymentMilestones.status, "paid"),
        sql`to_char(${paymentMilestones.paidAt} at time zone ${timeZone}, 'YYYY-MM') = ${month}`,
      ),
    )
    .groupBy(paymentMilestones.currency);

  return {
    today,
    statusCounts,
    needsReply,
    openChangeRequests,
    overdueDeposits,
    awaitingBalance,
    lateProjects,
    collectedThisMonth: collectedThisMonth.map((r) => ({ ...r, totalMinor: r.totalMinor ?? 0 })),
    renewals: await upcomingRenewals(db, { today, days: 14 }),
  };
}
