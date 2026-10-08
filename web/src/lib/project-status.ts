/**
 * Project lifecycle: 16 internal statuses (+ follow_up) and 4 side statuses for the
 * admin, mapped onto the 7 stages the client sees (decision Q34-b, report 09 §6.1).
 * Pure module: no I/O.
 */

import type { Localized } from "./types";

export type { Localized };

export const MAIN_STATUSES = [
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
  "change_request",
  "awaiting_balance",
  "delivered",
  "warranty",
  "closed",
  "follow_up",
] as const;

export const SIDE_STATUSES = ["on_hold", "cancelled", "lost", "disputed"] as const;

export const PROJECT_STATUSES = [...MAIN_STATUSES, ...SIDE_STATUSES] as const;

export type MainStatus = (typeof MAIN_STATUSES)[number];
export type SideStatus = (typeof SIDE_STATUSES)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const STATUS_LABELS_AR: Record<ProjectStatus, string> = {
  lead: "عميل محتمل",
  qualified: "مؤهَّل",
  discovery: "اكتشاف",
  quote_draft: "مسودة عرض",
  quote_sent: "عرض مُرسل",
  awaiting_deposit: "بانتظار المقدم",
  kickoff: "انطلاق",
  in_progress: "قيد التنفيذ",
  internal_qa: "مراجعة جودة داخلية",
  client_review: "مراجعة العميل",
  revisions: "مراجعات",
  change_request: "طلب تغيير",
  awaiting_balance: "بانتظار الرصيد",
  delivered: "تم التسليم",
  warranty: "ضمان",
  closed: "إغلاق",
  follow_up: "متابعة",
  on_hold: "معلّق",
  cancelled: "ملغى",
  lost: "خسرناه",
  disputed: "نزاع",
};

export function isMainStatus(value: string): value is MainStatus {
  return (MAIN_STATUSES as readonly string[]).includes(value);
}

export function isSideStatus(value: string): value is SideStatus {
  return (SIDE_STATUSES as readonly string[]).includes(value);
}

export function isProjectStatus(value: string): value is ProjectStatus {
  return (PROJECT_STATUSES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Client stages
// ---------------------------------------------------------------------------

export const CLIENT_STAGES = [
  "received",
  "quote",
  "awaiting_deposit",
  "in_progress",
  "client_review",
  "delivered",
  "warranty",
] as const;

export type ClientStage = (typeof CLIENT_STAGES)[number];

export const CLIENT_STAGE_LABELS: Record<ClientStage, Localized> = {
  received: { ar: "استلام الطلب", en: "Request received" },
  quote: { ar: "عرض السعر", en: "Quote" },
  awaiting_deposit: { ar: "بانتظار الدفعة المقدمة", en: "Awaiting deposit" },
  in_progress: { ar: "قيد التنفيذ", en: "In progress" },
  client_review: { ar: "بانتظار مراجعتك", en: "Awaiting your review" },
  delivered: { ar: "تم التسليم", en: "Delivered" },
  warranty: { ar: "الضمان والمتابعة", en: "Warranty & follow-up" },
};

export const CLIENT_FLAGS = ["revisions", "change_request"] as const;
export type ClientFlag = (typeof CLIENT_FLAGS)[number];

export const CLIENT_FLAG_LABELS: Record<ClientFlag, Localized> = {
  revisions: { ar: "تعديلات", en: "Revisions" },
  change_request: { ar: "طلب إضافة", en: "Change request" },
};

const STAGE_OF: Record<MainStatus, ClientStage> = {
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

const STATUS_DETAIL: Record<MainStatus, Localized> = {
  lead: { ar: "استلمنا طلبك ونراجع التفاصيل.", en: "We have received your request and are reviewing the details." },
  qualified: { ar: "استلمنا طلبك ونراجع التفاصيل.", en: "We have received your request and are reviewing the details." },
  discovery: { ar: "نجمع التفاصيل اللازمة لتحديد النطاق والسعر.", en: "We are gathering the details needed to scope and price your project." },
  quote_draft: { ar: "نُعدّ عرض السعر لك.", en: "We are preparing your quote." },
  quote_sent: { ar: "عرض السعر جاهز لمراجعتك.", en: "Your quote is ready for review." },
  awaiting_deposit: { ar: "تم قبول العرض. نبدأ العمل بعد استلام الدفعة المقدمة.", en: "Quote accepted. Work starts once the deposit is received." },
  kickoff: { ar: "استلمنا الدفعة ونجهّز لبدء العمل.", en: "Payment received. We are getting started." },
  in_progress: { ar: "العمل جارٍ على مشروعك.", en: "Work on your project is under way." },
  internal_qa: { ar: "نراجع جودة العمل قبل عرضه عليك.", en: "We are checking quality before sharing it with you." },
  revisions: { ar: "ننفّذ ملاحظاتك.", en: "We are applying your feedback." },
  change_request: { ar: "نراجع طلب الإضافة ونُعدّ عرضًا له.", en: "We are reviewing your change request and preparing a quote for it." },
  // No approve/feedback buttons on the portal yet: point to the real channels.
  client_review: {
    ar: "المعاينة جاهزة. راجعها ثم أرسل لنا موافقتك أو ملاحظاتك عبر واتساب أو البريد.",
    en: "Your preview is ready. Please review it and send us your approval or feedback by WhatsApp or email.",
  },
  awaiting_balance: { ar: "تمت موافقتك. نسلّم الملفات النهائية بعد الدفعة الأخيرة.", en: "Approved. Final files are released after the last payment." },
  delivered: { ar: "تم تسليم مشروعك.", en: "Your project has been delivered." },
  warranty: { ar: "مشروعك في فترة الضمان.", en: "Your project is in its warranty period." },
  closed: { ar: "اكتمل المشروع. شكرًا لثقتك.", en: "Project complete. Thank you for your trust." },
  follow_up: { ar: "اكتمل المشروع. شكرًا لثقتك.", en: "Project complete. Thank you for your trust." },
};

/** Neutral client-facing messages for side statuses (no internal detail leaks). */
const SIDE_NOTICE: Record<SideStatus, Localized> = {
  on_hold: {
    ar: "المشروع متوقف مؤقتًا، وسنتواصل معك قبل استئنافه.",
    en: "This project is temporarily paused. We will contact you before resuming.",
  },
  disputed: {
    ar: "نراجع وضع مشروعك حاليًا، وسنتواصل معك قريبًا.",
    en: "We are currently reviewing your project and will contact you shortly.",
  },
  cancelled: {
    ar: "هذا المشروع مغلق. للاستفسار تواصل معنا.",
    en: "This project is closed. Contact us if you have any questions.",
  },
  lost: {
    ar: "هذا الطلب مغلق. يسعدنا التواصل معك متى احتجت.",
    en: "This request is closed. We are happy to help whenever you need us.",
  },
};

export interface StatusContext {
  /** The main status a project was in before entering a side status. */
  sideFrom?: MainStatus | null;
  /** Open change requests raise the "change request" flag outside that status too. */
  openChangeRequests?: number;
}

export interface ClientView {
  stage: ClientStage | null;
  /** 0-based position in CLIENT_STAGES, or null when unknown. */
  stageIndex: number | null;
  stageLabel: Localized | null;
  flags: ClientFlag[];
  /** Neutral message for side statuses. */
  notice: Localized | null;
  /** Short line describing the current step. */
  detail: Localized | null;
  /** Cancelled or lost: nothing further will happen. */
  isClosed: boolean;
}

export function clientStageOf(status: MainStatus): ClientStage {
  return STAGE_OF[status];
}

export function clientView(status: ProjectStatus, ctx: StatusContext = {}): ClientView {
  if (isSideStatus(status)) {
    const stage = ctx.sideFrom ? STAGE_OF[ctx.sideFrom] : null;
    return {
      stage,
      stageIndex: stage ? CLIENT_STAGES.indexOf(stage) : null,
      stageLabel: stage ? CLIENT_STAGE_LABELS[stage] : null,
      flags: [],
      notice: SIDE_NOTICE[status],
      detail: null,
      isClosed: status === "cancelled" || status === "lost",
    };
  }

  const stage = STAGE_OF[status];
  const flags: ClientFlag[] = [];
  if (status === "revisions") flags.push("revisions");
  if (status === "change_request" || (ctx.openChangeRequests ?? 0) > 0) flags.push("change_request");

  return {
    stage,
    stageIndex: CLIENT_STAGES.indexOf(stage),
    stageLabel: CLIENT_STAGE_LABELS[stage],
    flags,
    notice: null,
    detail: STATUS_DETAIL[status],
    isClosed: false,
  };
}

/** Whether moving between two views is worth a client-visible timeline event. */
export function isClientVisibleChange(before: ClientView, after: ClientView): boolean {
  return (
    before.stage !== after.stage ||
    before.notice?.ar !== after.notice?.ar ||
    before.flags.join(",") !== after.flags.join(",")
  );
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

const PRE_DEPOSIT: readonly MainStatus[] = [
  "lead",
  "qualified",
  "discovery",
  "quote_draft",
  "quote_sent",
  "awaiting_deposit",
];

/** Statuses reached only after money changed hands (a dispute is possible). */
const PAID_PHASE: readonly MainStatus[] = [
  "kickoff",
  "in_progress",
  "internal_qa",
  "client_review",
  "revisions",
  "change_request",
  "awaiting_balance",
  "delivered",
  "warranty",
  "closed",
  "follow_up",
];

/** Active work that can be paused or cancelled. */
const PAUSABLE: readonly MainStatus[] = [
  ...PRE_DEPOSIT,
  "kickoff",
  "in_progress",
  "internal_qa",
  "client_review",
  "revisions",
  "change_request",
  "awaiting_balance",
];

const MAIN_FLOW: Record<MainStatus, readonly MainStatus[]> = {
  lead: ["qualified", "discovery", "quote_draft"],
  qualified: ["discovery", "quote_draft"],
  discovery: ["quote_draft"],
  quote_draft: ["quote_sent", "discovery"],
  quote_sent: ["awaiting_deposit", "quote_draft"],
  awaiting_deposit: ["kickoff", "quote_draft"],
  kickoff: ["in_progress"],
  in_progress: ["internal_qa", "change_request"],
  internal_qa: ["client_review", "in_progress"],
  client_review: ["revisions", "change_request", "awaiting_balance", "delivered"],
  revisions: ["internal_qa", "client_review", "change_request"],
  change_request: ["in_progress", "client_review"],
  awaiting_balance: ["delivered"],
  delivered: ["warranty"],
  warranty: ["closed"],
  closed: ["follow_up"],
  follow_up: [],
};

function sideTargetsFromMain(from: MainStatus): SideStatus[] {
  const targets: SideStatus[] = [];
  if (PAUSABLE.includes(from)) targets.push("on_hold", "cancelled");
  if (PRE_DEPOSIT.includes(from)) targets.push("lost");
  if (PAID_PHASE.includes(from)) targets.push("disputed");
  return targets;
}

export function allowedTransitions(from: ProjectStatus, ctx: StatusContext = {}): ProjectStatus[] {
  if (isMainStatus(from)) {
    return [...MAIN_FLOW[from], ...sideTargetsFromMain(from)];
  }

  const resume = ctx.sideFrom ?? null;
  const targets: ProjectStatus[] = [];
  switch (from) {
    case "on_hold":
      if (resume) targets.push(resume);
      targets.push("cancelled");
      if (resume && PRE_DEPOSIT.includes(resume)) targets.push("lost");
      if (resume && PAID_PHASE.includes(resume)) targets.push("disputed");
      break;
    case "disputed":
      if (resume) targets.push(resume);
      targets.push("cancelled", "closed");
      break;
    case "cancelled":
    case "lost":
      break;
  }
  return [...new Set(targets)];
}

export function canTransition(from: ProjectStatus, to: ProjectStatus, ctx: StatusContext = {}): boolean {
  return from !== to && allowedTransitions(from, ctx).includes(to);
}

export function isTerminal(status: ProjectStatus): boolean {
  return status === "cancelled" || status === "lost" || status === "follow_up";
}

/**
 * The `sideFrom` value to store after a transition: remember where we left the
 * main flow; keep it while moving between side statuses; clear it on return.
 */
export function nextSideFrom(
  from: ProjectStatus,
  to: ProjectStatus,
  currentSideFrom: MainStatus | null,
): MainStatus | null {
  if (!isSideStatus(to)) return null;
  if (isMainStatus(from)) return from;
  return currentSideFrom;
}

// ---------------------------------------------------------------------------
// Business guards (facts are loaded by the service layer)
// ---------------------------------------------------------------------------

export interface TransitionFacts {
  hasSentQuote: boolean;
  hasAcceptedQuote: boolean;
  depositPaid: boolean;
  allMilestonesPaid: boolean;
}

export type GuardFailure = "quote_not_sent" | "quote_not_accepted" | "deposit_not_paid" | "milestones_unpaid";

export const GUARD_MESSAGES_AR: Record<GuardFailure, string> = {
  quote_not_sent: "لا يوجد عرض سعر مُرسل لهذا المشروع.",
  quote_not_accepted: "لم يقبل العميل عرض السعر بعد.",
  deposit_not_paid: "الدفعة المقدمة لم تُسجَّل كمدفوعة.",
  milestones_unpaid: "لا يمكن التسليم النهائي قبل سداد كل الدفعات.",
};

export function checkTransitionGuard(to: ProjectStatus, facts: TransitionFacts): GuardFailure | null {
  switch (to) {
    case "quote_sent":
      return facts.hasSentQuote ? null : "quote_not_sent";
    case "awaiting_deposit":
      return facts.hasAcceptedQuote ? null : "quote_not_accepted";
    case "kickoff":
      return facts.depositPaid ? null : "deposit_not_paid";
    case "delivered":
      return facts.allMilestonesPaid ? null : "milestones_unpaid";
    default:
      return null;
  }
}

export class TransitionError extends Error {
  constructor(
    readonly code: "not_allowed" | GuardFailure,
    readonly from: ProjectStatus,
    readonly to: ProjectStatus,
  ) {
    super(
      code === "not_allowed"
        ? `Transition ${from} -> ${to} is not allowed`
        : `Transition ${from} -> ${to} blocked: ${code}`,
    );
    this.name = "TransitionError";
  }
}
