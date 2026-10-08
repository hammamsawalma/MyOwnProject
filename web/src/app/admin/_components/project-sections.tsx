import Link from "next/link";
import type { ReactNode } from "react";
import { ActionForm, SubmitButton } from "@/components/client";
import {
  Badge,
  ButtonLink,
  Card,
  Checkbox,
  DescriptionList,
  EmptyState,
  Field,
  Input,
  Ltr,
  Money,
  Notice,
  Select,
  TableWrap,
  Textarea,
  td,
  th,
} from "@/components/ui";
import type {
  changeRequests,
  clients,
  deliverables,
  documents,
  paymentMilestones,
  projectEvents,
  projects,
  quotes,
} from "@/db/schema";
import type { DocumentType } from "@/lib/domain-enums";
import { magicLinkState } from "@/lib/magic-links";
import { AR_NOUNS, arCount } from "@/lib/plural";
import { MILESTONE_KIND_LABELS, MILESTONE_KINDS, scheduleTotals } from "@/lib/payment-plan";
import {
  CLIENT_FLAG_LABELS,
  GUARD_MESSAGES_AR,
  STATUS_LABELS_AR,
  type ClientView,
  type GuardFailure,
  type ProjectStatus,
} from "@/lib/project-status";
import { clientTimelineMessage } from "@/lib/services/portal";
import { dateInputValue, formatDate, formatDateTime } from "@/lib/ui/format";
import {
  ACTOR_LABELS_AR,
  CHANGE_REQUEST_STATUS_LABELS_AR,
  DELIVERABLE_KIND_LABELS,
  MILESTONE_STATUS_LABELS,
  PACKAGE_TIER_LABELS,
  PRICING_MODEL_LABELS_AR,
  QUOTE_KIND_LABELS_AR,
  QUOTE_STATUS_LABELS_AR,
  milestoneTone,
  quoteTone,
} from "@/lib/ui/labels";
import {
  addDeliverableAction,
  addEventAction,
  assessChangeRequestAction,
  createChangeRequestAction,
  createMagicLinkAction,
  emailMagicLinkAction,
  releaseFinalsAction,
  resolveChangeRequestAction,
  revokeMagicLinkAction,
  toggleEventVisibilityAction,
  transitionAction,
  updateProjectDetailsAction,
} from "../_actions/projects";
import {
  createMilestoneAction,
  deleteMilestoneAction,
  issueCreditNoteAction,
  markMilestoneAction,
  recordPaymentAction,
  sendPaymentRequestAction,
} from "../_actions/payments";
import { sendQuoteAction } from "../_actions/quotes";
import { MagicLinkGenerator } from "./magic-link-generator";
import { eventTitleAr, StatusBadge } from "./status";

type Project = typeof projects.$inferSelect;
type Client = typeof clients.$inferSelect;
type Quote = typeof quotes.$inferSelect;
type Milestone = typeof paymentMilestones.$inferSelect;
type DocumentRow = typeof documents.$inferSelect;
type Deliverable = typeof deliverables.$inferSelect;
type ChangeRequest = typeof changeRequests.$inferSelect;
type ProjectEvent = typeof projectEvents.$inferSelect;
type MagicLinkRow = {
  id: string;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  useCount: number;
  createdAt: Date;
};

export const DOCUMENT_TYPE_LABELS_AR: Record<DocumentType, string> = {
  quote_pdf: "عرض سعر",
  receipt: "إيصال دفع",
  credit_note: "إشعار دائن",
  tax_invoice: "فاتورة ضريبية",
};

const documentHref = (id: string) => `/admin/files/documents/${id}`;

function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-border">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-brand marker:text-muted">
        {summary}
      </summary>
      <div className="border-t border-border p-3">{children}</div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface TransitionOption {
  to: ProjectStatus;
  blockedBy: GuardFailure | null;
}

export function StatusSection({
  project,
  view,
  options,
}: {
  project: Project;
  view: ClientView;
  options: TransitionOption[];
}) {
  return (
    <Card title="الحالة" id="status">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg bg-surface p-3">
          <p className="text-xs text-muted">الحالة الداخلية (تراها أنت)</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge status={project.status} />
            {project.sideFromStatus && (
              <span className="text-xs text-muted">توقف عند: {STATUS_LABELS_AR[project.sideFromStatus]}</span>
            )}
          </div>
        </div>
        <div className="rounded-lg bg-surface p-3">
          <p className="text-xs text-muted">ما يراه العميل</p>
          <p className="mt-1 font-bold">{view.stageLabel?.ar ?? "—"}</p>
          {view.flags.length > 0 && (
            <div className="mt-1 flex gap-1">
              {view.flags.map((f) => (
                <Badge key={f} tone="warning">
                  {CLIENT_FLAG_LABELS[f].ar}
                </Badge>
              ))}
            </div>
          )}
          <p className="mt-1 text-xs text-muted">{view.notice?.ar ?? view.detail?.ar}</p>
        </div>
      </div>

      {options.length === 0 ? (
        <p className="mt-4 text-sm text-muted">لا انتقالات متاحة من هذه الحالة.</p>
      ) : (
        <ActionForm action={transitionAction.bind(null, project.id)} className="mt-4 space-y-3" resetOnSuccess>
          <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
            <Field label="الانتقال إلى" htmlFor="to">
              <Select id="to" name="to" required defaultValue="">
                <option value="" disabled>
                  اختر الحالة التالية
                </option>
                {options.map((o) => (
                  <option key={o.to} value={o.to} disabled={o.blockedBy !== null}>
                    {STATUS_LABELS_AR[o.to]}
                    {o.blockedBy ? ` (${GUARD_MESSAGES_AR[o.blockedBy]})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="ملاحظة داخلية (اختياري)" htmlFor="note" hint="لا تظهر للعميل. للخسارة: اكتب السبب.">
              <Input id="note" name="note" />
            </Field>
          </div>
          <SubmitButton size="sm" pendingLabel="جارٍ التغيير…">
            تغيير الحالة
          </SubmitButton>
        </ActionForm>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export function QuotesSection({
  project,
  quotes,
  documents,
}: {
  project: Project;
  quotes: Quote[];
  documents: DocumentRow[];
}) {
  const base = `/admin/projects/${project.id}/quotes`;
  return (
    <Card
      title="عروض الأسعار"
      id="quotes"
      description="الرقم Q يُمنح عند الإصدار، والعرض المُصدر لا يُعدّل (نسخة جديدة بدلًا من ذلك)"
      actions={
        <>
          <ButtonLink href={`${base}/new`} size="sm">
            عرض جديد
          </ButtonLink>
          <ButtonLink href={`${base}/new?kind=addon`} size="sm" variant="secondary">
            عرض إضافة
          </ButtonLink>
        </>
      }
    >
      {quotes.length === 0 ? (
        <EmptyState>لا عروض بعد.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {[...quotes].reverse().map((q) => {
            const pdf = documents.find((d) => d.type === "quote_pdf" && d.quoteId === q.id);
            return (
              <li key={q.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      <bdi>{q.title}</bdi>{" "}
                      <span className="text-xs text-muted">
                        · الإصدار {q.version} · {QUOTE_KIND_LABELS_AR[q.kind]}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {q.ref ? <Ltr>{q.ref}</Ltr> : "بلا رقم (مسودة)"} · {PRICING_MODEL_LABELS_AR[q.pricingModel]}
                      {q.packageTier && ` (${PACKAGE_TIER_LABELS[q.packageTier].ar})`}
                      {q.validUntil && ` · صالح حتى ${formatDate(q.validUntil)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Money minor={q.totalMinor} currency={q.currency} className="font-bold" />
                    <Badge tone={quoteTone(q.status)}>{QUOTE_STATUS_LABELS_AR[q.status]}</Badge>
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted">
                  جدول الدفع:{" "}
                  {q.paymentPlan.map((m, i) => (
                    <span key={i}>
                      {i > 0 && " · "}
                      {MILESTONE_KIND_LABELS[m.kind].ar} <bdi dir="ltr">{m.percent}%</bdi> (
                      <Money minor={m.amountMinor} currency={q.currency} />)
                    </span>
                  ))}
                </p>
                {q.acceptedAt && (
                  <p className="mt-1 text-xs text-success">
                    قُبل في {formatDateTime(q.acceptedAt)} · IP <Ltr>{q.acceptedIp ?? "—"}</Ltr> · الشروط{" "}
                    <Ltr>{q.acceptedTermsVersion ?? "—"}</Ltr>
                  </p>
                )}
                {/* Stays mounted after issuing so the result message survives the re-render. */}
                <ActionForm
                  action={sendQuoteAction.bind(null, project.id, q.id)}
                  confirm="سيصدر رقم عرض نهائي (Q) ولن يمكن تعديل العرض بعده. متابعة؟"
                  className="mt-3 space-y-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {q.status === "draft" && (
                      <>
                        <ButtonLink href={`${base}/${q.id}`} size="sm" variant="secondary">
                          تعديل المسودة
                        </ButtonLink>
                        <SubmitButton size="sm" pendingLabel="جارٍ الإصدار…">
                          إصدار وإرسال (PDF)
                        </SubmitButton>
                      </>
                    )}
                    {pdf && (
                      <a
                        href={documentHref(pdf.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-brand underline"
                      >
                        ملف PDF ‏<Ltr>{pdf.ref}</Ltr>
                      </a>
                    )}
                  </div>
                </ActionForm>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export function PaymentsSection({
  project,
  quotes,
  milestones,
  documents,
  salesEnabled,
}: {
  project: Project;
  quotes: Quote[];
  milestones: Milestone[];
  documents: DocumentRow[];
  salesEnabled: boolean;
}) {
  const acceptedQuoteIds = new Set(quotes.filter((q) => q.status === "accepted").map((q) => q.id));
  // Same basis as the receipts: the agreed, non-refunded schedule in the project currency.
  const { contractTotalMinor: total, paidToDateMinor: paid } = scheduleTotals(
    milestones,
    acceptedQuoteIds,
    project.currency,
  );
  return (
    <Card
      title="الدفعات"
      id="payments"
      description={
        milestones.length ? (
          <>
            المدفوع <Money minor={paid} currency={project.currency} /> من{" "}
            <Money minor={total} currency={project.currency} />
          </>
        ) : (
          "تُنشأ تلقائيًا من جدول الدفع عند قبول العرض، ويمكن إضافة مسودات يدويًا"
        )
      }
    >
      {!salesEnabled && (
        <Notice tone="warning" className="mb-4">
          البيع مطفأ: إرسال روابط الدفع وتسجيل الدفعات معطّلان، والعميل لا يرى أي رابط دفع. يمكنك إضافة الدفعات كمسودات.
        </Notice>
      )}
      {milestones.length === 0 ? (
        <EmptyState>لا دفعات بعد.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {milestones.map((m) => {
            const receipt = documents.find((d) => d.type === "receipt" && d.milestoneId === m.id);
            const open = m.status === "draft" || m.status === "sent";
            return (
              <li key={m.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {m.sequence}. {m.label ?? MILESTONE_KIND_LABELS[m.kind].ar}
                    </p>
                    <p className="text-xs text-muted">
                      {MILESTONE_KIND_LABELS[m.kind].ar}
                      {m.sentAt && ` · أُرسل ${formatDate(m.sentAt)}`}
                      {m.paidAt && ` · دُفع ${formatDate(m.paidAt)}`}
                      {m.provider && ` · ${m.provider}`}
                      {m.providerRef && (
                        <>
                          {" · "}
                          <Ltr>{m.providerRef}</Ltr>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Money minor={m.amountMinor} currency={m.currency} className="font-bold" />
                    <Badge tone={milestoneTone(m.status)}>{MILESTONE_STATUS_LABELS[m.status].ar}</Badge>
                  </div>
                </div>

                {m.payUrl && (
                  <p className="mt-2 text-xs">
                    رابط الدفع: <Ltr className="break-all text-muted">{m.payUrl}</Ltr>{" "}
                    {!salesEnabled && <Badge tone="neutral">مخفي عن العميل</Badge>}
                  </p>
                )}
                {(m.evidenceNote || m.evidenceKey) && (
                  <p className="mt-1 text-xs text-muted">
                    الإثبات: {m.evidenceNote ?? ""}{" "}
                    {m.evidenceKey && (
                      <a
                        href={`/admin/files/evidence/${m.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand underline"
                      >
                        الملف
                      </a>
                    )}
                  </p>
                )}
                {receipt && (
                  <p className="mt-1 text-xs">
                    <a
                      href={documentHref(receipt.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand underline"
                    >
                      الإيصال <Ltr>{receipt.ref}</Ltr>
                    </a>
                  </p>
                )}

                <div className={open ? "mt-3 grid gap-2 md:grid-cols-2" : undefined}>
                  {open && (
                    <Disclosure summary={m.status === "sent" ? "تحديث رابط الدفع" : "إرسال رابط الدفع"}>
                      <ActionForm action={sendPaymentRequestAction.bind(null, project.id, m.id)} className="space-y-2">
                        <fieldset disabled={!salesEnabled} className="space-y-2">
                          <Field label="رابط الدفع (https)" htmlFor={`payUrl-${m.id}`}>
                            <Input
                              id={`payUrl-${m.id}`}
                              name="payUrl"
                              type="url"
                              dir="ltr"
                              required
                              defaultValue={m.payUrl ?? ""}
                            />
                          </Field>
                          <Field label="المزوّد" htmlFor={`provider-${m.id}`}>
                            <Input
                              id={`provider-${m.id}`}
                              name="provider"
                              dir="ltr"
                              defaultValue={m.provider ?? "payoneer"}
                            />
                          </Field>
                          <SubmitButton size="sm">إرسال للعميل</SubmitButton>
                        </fieldset>
                      </ActionForm>
                    </Disclosure>
                  )}
                  {/* Stays mounted once paid so the receipt message remains visible. */}
                  <ActionForm action={recordPaymentAction.bind(null, project.id, m.id)} className="space-y-2">
                    {open && (
                      <Disclosure summary="تسجيل الدفع يدويًا + إيصال">
                        <fieldset disabled={!salesEnabled} className="space-y-2">
                          <Field label="تاريخ الدفع" htmlFor={`paidAt-${m.id}`}>
                            <Input
                              id={`paidAt-${m.id}`}
                              name="paidAt"
                              type="date"
                              dir="ltr"
                              defaultValue={dateInputValue()}
                            />
                          </Field>
                          <div className="grid grid-cols-2 gap-2">
                            <Field label="الوسيلة" htmlFor={`rp-${m.id}`}>
                              <Input id={`rp-${m.id}`} name="provider" dir="ltr" defaultValue={m.provider ?? ""} />
                            </Field>
                            <Field label="مرجع المعاملة" htmlFor={`ref-${m.id}`}>
                              <Input id={`ref-${m.id}`} name="providerRef" dir="ltr" />
                            </Field>
                          </div>
                          <Field label="ملاحظة الإثبات" htmlFor={`en-${m.id}`}>
                            <Input id={`en-${m.id}`} name="evidenceNote" placeholder="مثل: وصل إشعار Payoneer" />
                          </Field>
                          <Field label="ملف الإثبات (اختياري)" htmlFor={`ev-${m.id}`}>
                            <Input
                              id={`ev-${m.id}`}
                              name="evidence"
                              type="file"
                              accept="image/*,application/pdf"
                              className="py-1.5"
                            />
                          </Field>
                          <SubmitButton size="sm">تم الدفع: أصدر الإيصال</SubmitButton>
                        </fieldset>
                      </Disclosure>
                    )}
                  </ActionForm>
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  {m.status === "draft" && !(m.quoteId && acceptedQuoteIds.has(m.quoteId)) && (
                    <ActionForm action={deleteMilestoneAction.bind(null, project.id, m.id)} confirm="حذف هذه المسودة؟">
                      <SubmitButton size="sm" variant="ghost">
                        حذف المسودة
                      </SubmitButton>
                    </ActionForm>
                  )}
                  {(m.status === "paid" || m.status === "disputed") && (
                    <Disclosure summary="استرداد / اعتراض">
                      <div className="space-y-2">
                        <ActionForm
                          action={markMilestoneAction.bind(null, project.id, m.id, "refunded")}
                          className="space-y-2"
                        >
                          <Input name="note" placeholder="سبب الاسترداد" />
                          <SubmitButton size="sm" variant="secondary">
                            تسجيلها مستردة
                          </SubmitButton>
                        </ActionForm>
                        {m.status === "paid" && (
                          <ActionForm
                            action={markMilestoneAction.bind(null, project.id, m.id, "disputed")}
                            className="space-y-2"
                          >
                            <Input name="note" placeholder="تفاصيل الاعتراض" />
                            <SubmitButton size="sm" variant="danger">
                              تسجيل اعتراض عليها
                            </SubmitButton>
                          </ActionForm>
                        )}
                        {m.status === "disputed" && (
                          <ActionForm
                            action={markMilestoneAction.bind(null, project.id, m.id, "paid")}
                            className="space-y-2"
                          >
                            <Input name="note" placeholder="كيف حُسم الاعتراض (مثل: كسبنا النزاع لدى المزوّد)" />
                            <SubmitButton size="sm" variant="secondary">
                              حُسم الاعتراض: الدفعة مدفوعة
                            </SubmitButton>
                          </ActionForm>
                        )}
                      </div>
                    </Disclosure>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4">
        <Disclosure summary="إضافة دفعة (مسودة)">
          <ActionForm action={createMilestoneAction.bind(null, project.id)} className="space-y-3" resetOnSuccess>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="النوع" htmlFor="ms-kind">
                <Select id="ms-kind" name="kind" defaultValue="addon">
                  {MILESTONE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {MILESTONE_KIND_LABELS[k].ar}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="الوصف" htmlFor="ms-label">
                <Input id="ms-label" name="label" placeholder="اختياري" />
              </Field>
              <Field label="المبلغ" htmlFor="ms-amount">
                <Input id="ms-amount" name="amount" inputMode="decimal" dir="ltr" required placeholder="250.00" />
              </Field>
              <Field label="العملة" htmlFor="ms-currency" hint="عملة المشروع">
                <input type="hidden" name="currency" value={project.currency} />
                <Input id="ms-currency" value={project.currency} dir="ltr" readOnly disabled />
              </Field>
            </div>
            <SubmitButton size="sm" variant="secondary">
              إضافة كمسودة
            </SubmitButton>
          </ActionForm>
        </Disclosure>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export function DocumentsSection({ project, documents }: { project: Project; documents: DocumentRow[] }) {
  return (
    <Card title="المستندات" id="documents" description="مستندات مُصدرة غير قابلة للتعديل؛ التصحيح بإشعار دائن">
      {documents.length === 0 ? (
        <EmptyState>لا مستندات بعد.</EmptyState>
      ) : (
        <TableWrap>
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr>
                <th className={th}>المستند</th>
                <th className={th}>الرقم</th>
                <th className={th}>المبلغ</th>
                <th className={th}>الإصدار</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id}>
                  <td className={td}>{DOCUMENT_TYPE_LABELS_AR[d.type]}</td>
                  <td className={td}>
                    <Ltr>{d.ref}</Ltr>
                  </td>
                  <td className={td}>
                    <Money minor={d.amountMinor} currency={d.currency} />
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{formatDate(d.issuedAt)}</td>
                  <td className={td}>
                    <a href={documentHref(d.id)} target="_blank" rel="noreferrer" className="text-brand underline">
                      PDF
                    </a>
                    {d.type === "receipt" && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-muted">إشعار دائن</summary>
                        <ActionForm
                          action={issueCreditNoteAction.bind(null, project.id, d.id)}
                          className="mt-2 w-56 space-y-2"
                        >
                          <Input name="reason" placeholder="السبب" required />
                          <Input
                            name="amount"
                            dir="ltr"
                            inputMode="decimal"
                            placeholder="المبلغ (فارغ = كامل الإيصال)"
                          />
                          <SubmitButton size="sm" variant="secondary">
                            إصدار إشعار دائن
                          </SubmitButton>
                        </ActionForm>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Deliverables
// ---------------------------------------------------------------------------

export function DeliverablesSection({
  project,
  deliverables,
  allPaid,
}: {
  project: Project;
  deliverables: Deliverable[];
  allPaid: boolean;
}) {
  const lockedFinals = deliverables.filter((d) => d.kind === "final" && !d.released).length;
  return (
    <Card
      title="التسليمات"
      id="deliverables"
      description="المعاينات تظهر للعميل فورًا؛ النهائية تُفتح فقط بعد سداد كل الدفعات، وتنزيلها برمز تحقق"
    >
      {deliverables.length === 0 ? (
        <EmptyState>لا تسليمات بعد.</EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {deliverables.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="font-medium">
                  <bdi>{d.title}</bdi>
                </p>
                <p className="text-xs text-muted">
                  {DELIVERABLE_KIND_LABELS[d.kind].ar} · {d.fileName ?? (d.externalUrl ? "رابط خارجي" : "")}
                  {d.releasedAt && ` · مُتاح منذ ${formatDate(d.releasedAt)}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={d.released ? "success" : "neutral"}>{d.released ? "ظاهر للعميل" : "مغلق"}</Badge>
                <a
                  href={d.fileKey ? `/admin/files/deliverables/${d.id}` : (d.externalUrl ?? "#")}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-brand underline"
                >
                  فتح
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ActionForm
        action={releaseFinalsAction.bind(null, project.id)}
        confirm="فتح التسليمات النهائية للعميل؟"
        className="mt-3 space-y-2"
      >
        {lockedFinals > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton size="sm" disabled={!allPaid}>
              فتح التسليمات النهائية ({lockedFinals})
            </SubmitButton>
            {!allPaid && <span className="text-xs text-muted">متاح بعد سداد كل الدفعات.</span>}
          </div>
        )}
      </ActionForm>

      <div className="mt-4">
        <Disclosure summary="إضافة تسليم">
          <ActionForm action={addDeliverableAction.bind(null, project.id)} className="space-y-3" resetOnSuccess>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="النوع" htmlFor="dl-kind">
                <Select id="dl-kind" name="kind" defaultValue="preview">
                  <option value="preview">معاينة (تظهر فورًا)</option>
                  <option value="final">تسليم نهائي (بعد السداد)</option>
                </Select>
              </Field>
              <Field label="العنوان" htmlFor="dl-title">
                <Input id="dl-title" name="title" required />
              </Field>
              <Field label="رابط خارجي" htmlFor="dl-url" hint="فيديو أو بيئة اختبار أو مجلد">
                <Input id="dl-url" name="externalUrl" type="url" dir="ltr" placeholder="https://" />
              </Field>
              <Field label="أو ملف" htmlFor="dl-file" hint="حتى 25 ميغابايت؛ الأكبر عبر رابط خارجي">
                <Input id="dl-file" name="file" type="file" className="py-1.5" />
              </Field>
            </div>
            <SubmitButton size="sm" variant="secondary">
              إضافة
            </SubmitButton>
          </ActionForm>
        </Disclosure>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Change requests
// ---------------------------------------------------------------------------

export function ChangeRequestsSection({ project, requests }: { project: Project; requests: ChangeRequest[] }) {
  return (
    <Card title="طلبات التغيير" id="change-requests" description="ضمن النطاق = تعديل مشمول؛ خارجه = عرض إضافة بسعر">
      {requests.length === 0 ? (
        <EmptyState>لا طلبات تغيير.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {requests.map((cr) => {
            const active = cr.status === "open" || cr.status === "quoted" || cr.status === "accepted";
            return (
              <li key={cr.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p dir="auto" className="min-w-0 whitespace-pre-line">
                    {cr.description}
                  </p>
                  <div className="flex items-center gap-1">
                    {cr.inScope === true && <Badge tone="info">ضمن النطاق</Badge>}
                    {cr.inScope === false && <Badge tone="warning">خارج النطاق</Badge>}
                    <Badge>{CHANGE_REQUEST_STATUS_LABELS_AR[cr.status]}</Badge>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted">
                  من: {ACTOR_LABELS_AR[cr.requestedBy]} · {formatDateTime(cr.createdAt)}
                </p>
                {active && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {cr.status === "open" && (
                      <>
                        <ActionForm action={assessChangeRequestAction.bind(null, project.id, cr.id, true)}>
                          <SubmitButton size="sm" variant="secondary">
                            ضمن النطاق
                          </SubmitButton>
                        </ActionForm>
                        <ActionForm action={assessChangeRequestAction.bind(null, project.id, cr.id, false)}>
                          <SubmitButton size="sm" variant="secondary">
                            خارج النطاق
                          </SubmitButton>
                        </ActionForm>
                        {cr.inScope === false && !cr.quoteId && (
                          <ButtonLink
                            size="sm"
                            href={`/admin/projects/${project.id}/quotes/new?kind=addon&changeRequestId=${cr.id}`}
                          >
                            إنشاء عرض إضافة
                          </ButtonLink>
                        )}
                      </>
                    )}
                    <ActionForm action={resolveChangeRequestAction.bind(null, project.id, cr.id, "done")}>
                      <SubmitButton size="sm" variant="ghost">
                        تم التنفيذ
                      </SubmitButton>
                    </ActionForm>
                    <ActionForm action={resolveChangeRequestAction.bind(null, project.id, cr.id, "declined")}>
                      <SubmitButton size="sm" variant="ghost">
                        رفض الطلب
                      </SubmitButton>
                    </ActionForm>
                    <ActionForm action={resolveChangeRequestAction.bind(null, project.id, cr.id, "cancelled")}>
                      <SubmitButton size="sm" variant="ghost">
                        إلغاء الطلب
                      </SubmitButton>
                    </ActionForm>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-4">
        <Disclosure summary="تسجيل طلب تغيير">
          <ActionForm action={createChangeRequestAction.bind(null, project.id)} className="space-y-3" resetOnSuccess>
            <Field label="الوصف" htmlFor="cr-desc">
              <Textarea id="cr-desc" name="description" required />
            </Field>
            <Field label="طلبه" htmlFor="cr-by">
              <Select id="cr-by" name="requestedBy" defaultValue="client" className="max-w-xs">
                <option value="client">العميل</option>
                <option value="admin">أنت</option>
              </Select>
            </Field>
            <SubmitButton size="sm" variant="secondary">
              تسجيل
            </SubmitButton>
          </ActionForm>
        </Disclosure>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export function TimelineSection({ project, events }: { project: Project; events: ProjectEvent[] }) {
  return (
    <Card title="الخط الزمني" id="timeline" description="كل حدث مسجّل؛ تتحكم في ما يظهر منه للعميل">
      <Disclosure summary="إضافة رسالة للعميل أو ملاحظة داخلية">
        <ActionForm action={addEventAction.bind(null, project.id)} className="space-y-3" resetOnSuccess>
          <Field label="النص" htmlFor="ev-text">
            <Textarea id="ev-text" name="text" required />
          </Field>
          <Checkbox name="visibleToClient" label="يظهر للعميل في صفحة التتبع (وإلا فهو ملاحظة داخلية)" />
          <SubmitButton size="sm" variant="secondary">
            إضافة
          </SubmitButton>
        </ActionForm>
      </Disclosure>

      <ol className="mt-4 space-y-0">
        {[...events].reverse().map((e) => {
          const clientText = clientTimelineMessage(e);
          return (
            <li key={e.id} className="relative border-s-2 border-border ps-4 pb-4 last:pb-0">
              <span
                aria-hidden
                className={`absolute -start-[7px] top-1.5 size-3 rounded-full border-2 border-white ${e.visibleToClient && clientText ? "bg-brand" : "bg-gray-300"}`}
              />
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{eventTitleAr(e)}</p>
                  <p className="text-xs text-muted">
                    {ACTOR_LABELS_AR[e.actor]} · {formatDateTime(e.createdAt)}
                  </p>
                </div>
                {clientText ? (
                  <ActionForm action={toggleEventVisibilityAction.bind(null, project.id, e.id, !e.visibleToClient)}>
                    <SubmitButton size="sm" variant={e.visibleToClient ? "secondary" : "ghost"}>
                      {e.visibleToClient ? "ظاهر للعميل ✓ (إخفاء)" : "مخفي (إظهار للعميل)"}
                    </SubmitButton>
                  </ActionForm>
                ) : (
                  <Badge>داخلي فقط</Badge>
                )}
              </div>
              {e.note && <p className="mt-1 whitespace-pre-line rounded bg-surface px-2 py-1 text-sm">{e.note}</p>}
              {clientText && e.visibleToClient && (
                <p className="mt-1 text-xs text-brand">يراه العميل: «{clientText.ar}»</p>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Side column
// ---------------------------------------------------------------------------

export function LinksSection({ project, client, links }: { project: Project; client: Client; links: MagicLinkRow[] }) {
  const now = new Date();
  const active = links.filter((l) => magicLinkState(l, now) === "active");
  return (
    <Card title="رابط تتبع العميل" id="links" description="رابط سري لكل مشروع؛ تُحفظ بصمته المشفّرة (hash) فقط">
      <MagicLinkGenerator action={createMagicLinkAction.bind(null, project.id)} hasActiveLinks={active.length > 0} />
      <div className="mt-3 border-t border-border pt-3">
        <ActionForm
          action={emailMagicLinkAction.bind(null, project.id)}
          confirm="سيُنشأ رابط جديد ويُرسل لبريد العميل، وتُلغى الروابط السابقة. متابعة؟"
          className="space-y-2"
        >
          <SubmitButton size="sm" variant="ghost" disabled={!client.email}>
            إرسال رابط جديد إلى بريد العميل
          </SubmitButton>
          {!client.email && <p className="text-xs text-muted">أضف بريد العميل أولًا.</p>}
        </ActionForm>
      </div>
      {links.length > 0 && (
        <ul className="mt-3 space-y-2 border-t border-border pt-3">
          {[...links].reverse().map((l) => {
            const state = magicLinkState(l, now);
            return (
              <li key={l.id} className="text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span>
                    <Badge tone={state === "active" ? "success" : "neutral"}>
                      {state === "active" ? "نشط" : state === "expired" ? "منتهي" : "ملغى"}
                    </Badge>{" "}
                    أُنشئ {formatDate(l.createdAt)}
                  </span>
                  <ActionForm action={revokeMagicLinkAction.bind(null, project.id, l.id)} confirm="إلغاء هذا الرابط؟">
                    {state === "active" && (
                      <SubmitButton size="sm" variant="ghost" className="h-7 px-2 text-xs">
                        إلغاء
                      </SubmitButton>
                    )}
                  </ActionForm>
                </div>
                <p className="mt-0.5 text-muted">
                  ينتهي <span className="whitespace-nowrap">{formatDate(l.expiresAt)}</span> · الاستخدام {l.useCount}
                  {l.lastUsedAt && (
                    <>
                      {" · آخر استخدام "}
                      <span className="whitespace-nowrap">{formatDateTime(l.lastUsedAt)}</span>
                    </>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function DetailsSection({ project, client }: { project: Project; client: Client }) {
  return (
    <Card title="بيانات المشروع" id="details">
      <DescriptionList
        items={[
          {
            label: "العميل",
            value: (
              <Link href={`/admin/clients/${client.id}`} className="text-brand hover:underline">
                {client.name}
              </Link>
            ),
          },
          { label: "البريد", value: client.email ? <Ltr>{client.email}</Ltr> : "—" },
          {
            label: "التسعير",
            value: `${PRICING_MODEL_LABELS_AR[project.pricingModel]}${project.packageTier ? ` · ${PACKAGE_TIER_LABELS[project.packageTier].ar}` : ""}`,
          },
          {
            label: "القيمة",
            value:
              project.priceTotalMinor !== null ? (
                <Money minor={project.priceTotalMinor} currency={project.currency} />
              ) : (
                "—"
              ),
          },
          { label: "المراجعات", value: `${project.revisionsUsed} من ${project.revisionsIncluded}` },
          {
            label: "الضمان",
            value: project.warrantyEndsAt
              ? `حتى ${formatDate(project.warrantyEndsAt)}`
              : project.warrantyDays > 0
                ? arCount(project.warrantyDays, AR_NOUNS.day)
                : "بلا ضمان",
          },
          { label: "أُنشئ", value: formatDate(project.createdAt) },
          { label: "سُلّم", value: formatDate(project.deliveredAt) },
        ]}
      />
      <div className="mt-4 border-t border-border pt-4">
        <ActionForm action={updateProjectDetailsAction.bind(null, project.id)} className="space-y-3">
          <Field label="العنوان" htmlFor="pd-title">
            <Input id="pd-title" name="title" required defaultValue={project.title} />
          </Field>
          <Field label="الموعد المتفق عليه" htmlFor="pd-due" hint="يظهر في «المشاريع المتأخرة» إن تجاوزه">
            <Input id="pd-due" name="dueAt" type="date" dir="ltr" defaultValue={dateInputValue(project.dueAt)} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="الجهاز المُكلَّف" htmlFor="pd-machine">
              <Input id="pd-machine" name="assignedMachine" defaultValue={project.assignedMachine ?? ""} />
            </Field>
            <Field label="المسؤول عن التنفيذ" htmlFor="pd-person">
              <Input id="pd-person" name="assignedPerson" defaultValue={project.assignedPerson ?? ""} />
            </Field>
          </div>
          <Field label="رمز الخدمة" htmlFor="pd-service">
            <Input id="pd-service" name="serviceKey" dir="ltr" defaultValue={project.serviceKey ?? ""} />
          </Field>
          <SubmitButton size="sm" variant="secondary">
            حفظ
          </SubmitButton>
        </ActionForm>
      </div>
    </Card>
  );
}
