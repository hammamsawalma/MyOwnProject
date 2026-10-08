import { Badge } from "@/components/ui";
import { ltr } from "@/lib/bidi";
import { formatMoney } from "@/lib/money";
import { MILESTONE_KIND_LABELS } from "@/lib/payment-plan";
import { clientView, STATUS_LABELS_AR, type MainStatus, type ProjectStatus } from "@/lib/project-status";
import { EVENT_TYPE_LABELS_AR, statusTone } from "@/lib/ui/labels";

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge tone={statusTone(status)}>{STATUS_LABELS_AR[status]}</Badge>;
}

/** The client-stage label for an internal status, as the client would see it. */
export function clientStageText(status: ProjectStatus, sideFrom: MainStatus | null): string {
  const view = clientView(status, { sideFrom });
  if (view.stageLabel) return view.stageLabel.ar;
  return "—";
}

interface EventLike {
  type: string;
  fromStatus: ProjectStatus | null;
  toStatus: ProjectStatus | null;
  payload?: Record<string, unknown>;
}

/** One-line Arabic description of a timeline event for the admin. */
export function eventTitleAr(event: EventLike): string {
  const label = EVENT_TYPE_LABELS_AR[event.type] ?? event.type;
  const p = event.payload ?? {};
  switch (event.type) {
    case "status_changed":
      if (event.fromStatus && event.toStatus) {
        return `${label}: من «${STATUS_LABELS_AR[event.fromStatus]}» إلى «${STATUS_LABELS_AR[event.toStatus]}»`;
      }
      return label;
    case "quote_sent":
    case "quote_accepted":
      return typeof p.ref === "string" ? `${label} ${ltr(p.ref)}` : label;
    case "payment_recorded":
    case "payment_requested": {
      const kind = typeof p.kind === "string" && p.kind in MILESTONE_KIND_LABELS ? p.kind : null;
      const amount =
        typeof p.amountMinor === "number" && (p.currency === "USD" || p.currency === "EUR")
          ? ` ${ltr(formatMoney(p.amountMinor, p.currency))}`
          : "";
      const kindLabel = kind ? ` (${MILESTONE_KIND_LABELS[kind as keyof typeof MILESTONE_KIND_LABELS].ar})` : "";
      const receipt = typeof p.receiptRef === "string" ? ` · ${ltr(p.receiptRef)}` : "";
      return `${label}${kindLabel}${amount}${receipt}`;
    }
    case "deliverable_added":
      return typeof p.title === "string" ? `${label}: ${p.title}` : label;
    case "credit_note_issued":
      return typeof p.ref === "string" ? `${label} ${ltr(p.ref)}` : label;
    default:
      return label;
  }
}
