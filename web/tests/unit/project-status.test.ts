import { describe, expect, it } from "vitest";
import {
  allowedTransitions,
  canTransition,
  checkTransitionGuard,
  CLIENT_STAGES,
  CLIENT_STAGE_LABELS,
  clientView,
  isClientVisibleChange,
  MAIN_STATUSES,
  nextSideFrom,
  PROJECT_STATUSES,
  SIDE_STATUSES,
  STATUS_LABELS_AR,
  type MainStatus,
  type ProjectStatus,
  type TransitionFacts,
} from "@/lib/project-status";

const HAPPY_PATH: ProjectStatus[] = [
  "lead",
  "qualified",
  "discovery",
  "quote_draft",
  "quote_sent",
  "awaiting_deposit",
  "kickoff",
  "in_progress",
  "internal_qa",
  "client_review",
  "revisions",
  "client_review",
  "awaiting_balance",
  "delivered",
  "warranty",
  "closed",
  "follow_up",
];

describe("status catalogue", () => {
  it("has the 16 internal statuses + follow_up and the 4 side statuses", () => {
    expect(MAIN_STATUSES).toHaveLength(17);
    expect(MAIN_STATUSES.filter((s) => s !== "follow_up")).toHaveLength(16);
    expect([...SIDE_STATUSES]).toEqual(["on_hold", "cancelled", "lost", "disputed"]);
    expect(PROJECT_STATUSES).toHaveLength(21);
  });

  it("has an Arabic admin label for every status", () => {
    for (const status of PROJECT_STATUSES) expect(STATUS_LABELS_AR[status]).toBeTruthy();
  });

  it("exposes exactly the 7 approved client stages in order", () => {
    expect(CLIENT_STAGES.map((s) => CLIENT_STAGE_LABELS[s].ar)).toEqual([
      "استلام الطلب",
      "عرض السعر",
      "بانتظار الدفعة المقدمة",
      "قيد التنفيذ",
      "بانتظار مراجعتك",
      "تم التسليم",
      "الضمان والمتابعة",
    ]);
  });
});

describe("client view mapping", () => {
  const expected: Record<MainStatus, (typeof CLIENT_STAGES)[number]> = {
    lead: "received",
    qualified: "received",
    discovery: "received",
    quote_draft: "received",
    quote_sent: "quote",
    awaiting_deposit: "awaiting_deposit",
    kickoff: "in_progress",
    in_progress: "in_progress",
    internal_qa: "in_progress",
    revisions: "in_progress",
    change_request: "in_progress",
    client_review: "client_review",
    awaiting_balance: "client_review",
    delivered: "delivered",
    warranty: "warranty",
    closed: "warranty",
    follow_up: "warranty",
  };

  it.each(Object.entries(expected))("%s -> %s", (status, stage) => {
    const view = clientView(status as MainStatus);
    expect(view.stage).toBe(stage);
    expect(view.stageIndex).toBe(CLIENT_STAGES.indexOf(stage));
    expect(view.notice).toBeNull();
    expect(view.detail?.ar).toBeTruthy();
    expect(view.detail?.en).toBeTruthy();
  });

  it("raises side flags for revisions and change requests", () => {
    expect(clientView("revisions").flags).toEqual(["revisions"]);
    expect(clientView("change_request").flags).toEqual(["change_request"]);
    expect(clientView("in_progress").flags).toEqual([]);
    expect(clientView("in_progress", { openChangeRequests: 1 }).flags).toEqual(["change_request"]);
  });

  it("shows a neutral notice for side statuses and keeps the last stage", () => {
    for (const side of SIDE_STATUSES) {
      const view = clientView(side, { sideFrom: "in_progress" });
      expect(view.notice?.ar).toBeTruthy();
      expect(view.notice?.en).toBeTruthy();
      expect(view.stage).toBe("in_progress");
      expect(view.flags).toEqual([]);
      // Never leak the word "dispute" or internal codes to the client.
      expect(view.notice?.en.toLowerCase()).not.toContain("dispute");
    }
    expect(clientView("lost").stage).toBeNull();
    expect(clientView("cancelled").isClosed).toBe(true);
    expect(clientView("on_hold", { sideFrom: "kickoff" }).isClosed).toBe(false);
  });

  it("marks only stage/flag/notice changes as client-visible", () => {
    const visible = (a: ProjectStatus, b: ProjectStatus) => isClientVisibleChange(clientView(a), clientView(b));
    expect(visible("in_progress", "internal_qa")).toBe(false);
    expect(visible("lead", "qualified")).toBe(false);
    expect(visible("internal_qa", "client_review")).toBe(true);
    expect(visible("client_review", "revisions")).toBe(true);
    expect(visible("quote_draft", "quote_sent")).toBe(true);
    expect(isClientVisibleChange(clientView("in_progress"), clientView("on_hold", { sideFrom: "in_progress" }))).toBe(true);
  });
});

describe("transitions", () => {
  it("allows the whole happy path from lead to follow_up", () => {
    for (let i = 1; i < HAPPY_PATH.length; i++) {
      const from = HAPPY_PATH[i - 1] as ProjectStatus;
      const to = HAPPY_PATH[i] as ProjectStatus;
      expect(canTransition(from, to), `${from} -> ${to}`).toBe(true);
    }
  });

  it("blocks skipping steps and going backwards out of delivery", () => {
    expect(canTransition("lead", "kickoff")).toBe(false);
    expect(canTransition("quote_sent", "in_progress")).toBe(false);
    expect(canTransition("awaiting_deposit", "in_progress")).toBe(false);
    expect(canTransition("in_progress", "client_review")).toBe(false);
    expect(canTransition("delivered", "in_progress")).toBe(false);
    expect(canTransition("closed", "warranty")).toBe(false);
    expect(canTransition("lead", "lead")).toBe(false);
  });

  it("allows 100%-upfront projects to skip awaiting_balance", () => {
    expect(canTransition("client_review", "delivered")).toBe(true);
  });

  it("only allows 'lost' before any payment and 'disputed' after", () => {
    expect(canTransition("quote_sent", "lost")).toBe(true);
    expect(canTransition("in_progress", "lost")).toBe(false);
    expect(canTransition("quote_sent", "disputed")).toBe(false);
    expect(canTransition("delivered", "disputed")).toBe(true);
    expect(canTransition("closed", "disputed")).toBe(true);
    expect(canTransition("delivered", "on_hold")).toBe(false);
  });

  it("resumes from on_hold only to the status it left", () => {
    expect(allowedTransitions("on_hold", { sideFrom: "in_progress" })).toEqual(["in_progress", "cancelled", "disputed"]);
    expect(allowedTransitions("on_hold", { sideFrom: "quote_sent" })).toEqual(["quote_sent", "cancelled", "lost"]);
    expect(canTransition("on_hold", "kickoff", { sideFrom: "in_progress" })).toBe(false);
    expect(allowedTransitions("on_hold")).toEqual(["cancelled"]);
  });

  it("resolves disputes back, to cancelled or to closed", () => {
    expect(allowedTransitions("disputed", { sideFrom: "warranty" })).toEqual(["warranty", "cancelled", "closed"]);
    expect(allowedTransitions("disputed", { sideFrom: "closed" })).toEqual(["closed", "cancelled"]);
  });

  it("treats cancelled and lost as terminal", () => {
    expect(allowedTransitions("cancelled", { sideFrom: "lead" })).toEqual([]);
    expect(allowedTransitions("lost", { sideFrom: "lead" })).toEqual([]);
  });

  it("reaches every main status from lead and only targets known statuses", () => {
    const seen = new Set<ProjectStatus>(["lead"]);
    const queue: ProjectStatus[] = ["lead"];
    while (queue.length) {
      const current = queue.shift() as ProjectStatus;
      for (const next of allowedTransitions(current)) {
        expect(PROJECT_STATUSES).toContain(next);
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    for (const status of MAIN_STATUSES) expect(seen.has(status), status).toBe(true);
  });

  it("tracks where a project left the main flow", () => {
    expect(nextSideFrom("in_progress", "on_hold", null)).toBe("in_progress");
    expect(nextSideFrom("on_hold", "disputed", "in_progress")).toBe("in_progress");
    expect(nextSideFrom("on_hold", "in_progress", "in_progress")).toBeNull();
    expect(nextSideFrom("lead", "qualified", null)).toBeNull();
  });
});

describe("business guards", () => {
  const none: TransitionFacts = { hasSentQuote: false, hasAcceptedQuote: false, depositPaid: false, allMilestonesPaid: false };
  const all: TransitionFacts = { hasSentQuote: true, hasAcceptedQuote: true, depositPaid: true, allMilestonesPaid: true };

  it("requires a sent quote, an accepted quote, the deposit and full payment at the right steps", () => {
    expect(checkTransitionGuard("quote_sent", none)).toBe("quote_not_sent");
    expect(checkTransitionGuard("awaiting_deposit", none)).toBe("quote_not_accepted");
    expect(checkTransitionGuard("kickoff", none)).toBe("deposit_not_paid");
    expect(checkTransitionGuard("delivered", none)).toBe("milestones_unpaid");
    expect(checkTransitionGuard("in_progress", none)).toBeNull();
    for (const to of ["quote_sent", "awaiting_deposit", "kickoff", "delivered"] as const) {
      expect(checkTransitionGuard(to, all)).toBeNull();
    }
  });
});
