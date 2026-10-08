import type {
  ChangeRequestStatus,
  ClientType,
  DeliverableKind,
  EventActor,
  PackageTier,
  PricingModel,
  QuoteKind,
  QuoteStatus,
  Recurrence,
} from "@/lib/domain-enums";
import type { MilestoneStatus } from "@/lib/payment-plan";
import { clientStageOf, isMainStatus, type ClientStage, type ProjectStatus } from "@/lib/project-status";
import type { Localized } from "@/lib/types";

/** UI labels for enum values (admin is Arabic only; client-facing ones are bilingual). */

export const ACTOR_LABELS_AR: Record<EventActor, string> = {
  admin: "أنت",
  client: "العميل",
  system: "النظام",
};

export const EVENT_TYPE_LABELS_AR: Record<string, string> = {
  project_created: "إنشاء المشروع",
  status_changed: "تغيير الحالة",
  quote_drafted: "مسودة عرض سعر",
  quote_sent: "إرسال عرض السعر",
  quote_accepted: "قبول عرض السعر",
  payment_requested: "طلب دفعة",
  payment_recorded: "تسجيل دفعة",
  payment_refunded: "استرداد دفعة",
  payment_disputed: "اعتراض على دفعة",
  change_request_created: "طلب تغيير",
  client_update: "رسالة للعميل",
  note: "ملاحظة داخلية",
  deliverable_added: "إضافة تسليم",
  magic_link_created: "إنشاء رابط تتبع",
  magic_link_revoked: "إلغاء رابط تتبع",
  credit_note_issued: "إشعار دائن",
};

export const QUOTE_STATUS_LABELS_AR: Record<QuoteStatus, string> = {
  draft: "مسودة",
  sent: "مُرسل",
  accepted: "مقبول",
  declined: "مرفوض",
  expired: "منتهي الصلاحية",
  superseded: "استُبدل بنسخة أحدث",
};

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, Localized> = {
  draft: { ar: "مسودة", en: "Draft" },
  sent: { ar: "بانتظار موافقتك", en: "Awaiting your approval" },
  accepted: { ar: "مقبول", en: "Accepted" },
  declined: { ar: "مرفوض", en: "Declined" },
  expired: { ar: "انتهت صلاحيته", en: "Expired" },
  superseded: { ar: "استُبدل بنسخة أحدث", en: "Replaced by a newer version" },
};

export const QUOTE_KIND_LABELS_AR: Record<QuoteKind, string> = {
  initial: "عرض أساسي",
  addon: "عرض إضافة",
};

export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, Localized> = {
  draft: { ar: "مسودة", en: "Scheduled" },
  sent: { ar: "بانتظار الدفع", en: "Awaiting payment" },
  paid: { ar: "مدفوعة", en: "Paid" },
  refunded: { ar: "مستردة", en: "Refunded" },
  disputed: { ar: "معترض عليها", en: "Under review" },
};

export const CHANGE_REQUEST_STATUS_LABELS_AR: Record<ChangeRequestStatus, string> = {
  open: "مفتوح",
  quoted: "أُرسل عرضه",
  accepted: "مقبول",
  declined: "مرفوض",
  done: "منفّذ",
  cancelled: "ملغى",
};

export const PACKAGE_TIER_LABELS: Record<PackageTier, Localized> = {
  basic: { ar: "الأساسية", en: "Basic" },
  standard: { ar: "القياسية", en: "Standard" },
  premium: { ar: "المتقدمة", en: "Premium" },
};

export const PRICING_MODEL_LABELS_AR: Record<PricingModel, string> = {
  package: "باقة ثابتة",
  custom: "عرض مخصص",
};

export const CLIENT_TYPE_LABELS_AR: Record<ClientType, string> = {
  individual: "فرد",
  company: "شركة",
};

export const RECURRENCE_LABELS_AR: Record<Recurrence, string> = {
  none: "مرة واحدة",
  monthly: "شهري",
  yearly: "سنوي",
};

export const DELIVERABLE_KIND_LABELS: Record<DeliverableKind, Localized> = {
  preview: { ar: "معاينة", en: "Preview" },
  final: { ar: "تسليم نهائي", en: "Final delivery" },
};

export const LANGUAGE_LABELS_AR = { ar: "العربية", en: "الإنجليزية" } as const;

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "brand";

const STAGE_TONE: Record<ClientStage, Tone> = {
  received: "neutral",
  quote: "info",
  awaiting_deposit: "warning",
  in_progress: "brand",
  client_review: "warning",
  delivered: "success",
  warranty: "success",
};

export function statusTone(status: ProjectStatus): Tone {
  if (isMainStatus(status)) return STAGE_TONE[clientStageOf(status)];
  if (status === "disputed") return "danger";
  if (status === "on_hold") return "warning";
  return "neutral";
}

export function milestoneTone(status: MilestoneStatus): Tone {
  switch (status) {
    case "paid":
      return "success";
    case "sent":
      return "warning";
    case "disputed":
      return "danger";
    default:
      return "neutral";
  }
}

export function quoteTone(status: QuoteStatus): Tone {
  switch (status) {
    case "accepted":
      return "success";
    case "sent":
      return "info";
    case "draft":
      return "warning";
    default:
      return "neutral";
  }
}

/** Arabic (or English) country name from an ISO 3166-1 alpha-2 code. */
export function countryName(code: string | null, locale: "ar" | "en" = "ar"): string {
  if (!code) return "—";
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
