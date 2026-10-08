import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Badge, Card, Ltr, Money, Notice, cx } from "@/components/ui";
import { brand, whatsappUrl } from "@/config/brand";
import { CLIENT_PORTAL_PREFIX } from "@/config/routes";
import { getDb } from "@/db/client";
import { MILESTONE_KIND_LABELS, type MilestoneStatus } from "@/lib/payment-plan";
import { CLIENT_FLAG_LABELS } from "@/lib/project-status";
import { hasDownloadGrant, verifyPortalToken } from "@/lib/portal-access";
import { getClientPortalView, type ClientPortalView } from "@/lib/services/portal";
import type { Locale, Localized } from "@/lib/types";
import { formatDate } from "@/lib/ui/format";
import { QUOTE_STATUS_LABELS, quoteTone, milestoneTone } from "@/lib/ui/labels";
import { acceptQuoteAction, unlockFinalsAction } from "./actions";
import { dictionary, parseLocale, type Dictionary } from "./i18n";
import { AcceptQuoteForm, DocumentLanguage, UnlockFinalsForm } from "./portal-forms";

export const metadata: Metadata = {
  title: "متابعة المشروع · Project tracking",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

const CLIENT_MILESTONE_STATUS: Record<MilestoneStatus, Localized> = {
  draft: { ar: "قادمة", en: "Upcoming" },
  sent: { ar: "بانتظار الدفع", en: "Awaiting payment" },
  paid: { ar: "مدفوعة", en: "Paid" },
  refunded: { ar: "مستردة", en: "Refunded" },
  disputed: { ar: "قيد المراجعة", en: "Under review" },
};

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ lang?: string | string[] }> };

export default async function ClientTrackingPage({ params, searchParams }: Props) {
  const { token } = await params;
  const locale = parseLocale((await searchParams).lang);
  const t = dictionary(locale);
  const base = `${CLIENT_PORTAL_PREFIX}/${token}`;
  const toggleHref = locale === "ar" ? `${base}?lang=en` : base;

  const access = await verifyPortalToken(token);
  if (!access.ok) {
    const problem = access.reason === "malformed" ? "not_found" : access.reason;
    return (
      <Shell locale={locale} t={t} toggleHref={toggleHref}>
        <Card className="mx-auto max-w-lg text-center">
          <div className="py-6">
            <h1 className="text-xl font-bold">{t.linkProblem[problem].title}</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">{t.linkProblem[problem].body}</p>
          </div>
        </Card>
        <ContactCard t={t} />
      </Shell>
    );
  }

  const [view, unlocked] = await Promise.all([
    getClientPortalView(getDb(), access.projectId),
    hasDownloadGrant(access.projectId),
  ]);

  return (
    <Shell locale={locale} t={t} toggleHref={toggleHref}>
      <Overview view={view} locale={locale} t={t} />
      <Stepper view={view} locale={locale} t={t} />
      {view.quotes.map((quote) => (
        <QuoteCard key={quote.id} quote={quote} view={view} token={token} base={base} locale={locale} t={t} />
      ))}
      <PaymentsCard view={view} base={base} locale={locale} t={t} />
      <FilesCard view={view} token={token} base={base} locale={locale} t={t} unlocked={unlocked} />
      <TimelineCard view={view} locale={locale} t={t} />
      <ContactCard t={t} />
    </Shell>
  );
}

function Shell({
  locale,
  t,
  toggleHref,
  children,
}: {
  locale: Locale;
  t: Dictionary;
  toggleHref: string;
  children: ReactNode;
}) {
  return (
    <div dir={t.dir} lang={locale} className="min-h-screen bg-surface">
      <DocumentLanguage locale={locale} />
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-bold text-brand">{brand.logoText[locale]}</p>
            <p className="truncate text-xs text-muted">{brand.tagline[locale]}</p>
          </div>
          <a
            href={toggleHref}
            hrefLang={locale === "ar" ? "en" : "ar"}
            lang={locale === "ar" ? "en" : "ar"}
            className="shrink-0 rounded-full border border-border px-3 py-1 text-sm hover:border-brand"
          >
            {t.switchTo}
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-3xl px-4 pb-10 text-center text-xs text-muted">
        <p>{brand.name[locale]}</p>
        <p className="mt-1">{t.privateLink}</p>
      </footer>
    </div>
  );
}

function Overview({ view, locale, t }: { view: ClientPortalView; locale: Locale; t: Dictionary }) {
  const closedTone = view.view.isClosed ? "info" : "warning";
  return (
    <Card>
      <p className="text-sm text-muted">{t.hello(view.client.name)}</p>
      <h1 dir="auto" className="mt-1 text-xl font-bold leading-snug sm:text-2xl">
        {view.project.title}
      </h1>
      <p className="mt-1 text-xs text-muted">
        {t.projectRef}: <Ltr>{view.project.ref}</Ltr>
      </p>
      {view.view.notice ? (
        <Notice tone={closedTone} className="mt-4">
          {view.view.notice[locale]}
        </Notice>
      ) : (
        <div className="mt-4 rounded-lg bg-brand/5 p-4">
          <p className="text-xs text-muted">{t.currentStage}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className="text-lg font-bold text-brand">{view.view.stageLabel?.[locale]}</p>
            {view.view.flags.map((flag) => (
              <Badge key={flag} tone="warning">
                {CLIENT_FLAG_LABELS[flag][locale]}
              </Badge>
            ))}
          </div>
          {view.view.detail && <p className="mt-1 text-sm leading-relaxed">{view.view.detail[locale]}</p>}
        </div>
      )}
    </Card>
  );
}

function Stepper({ view, locale, t }: { view: ClientPortalView; locale: Locale; t: Dictionary }) {
  const last = view.stages.length - 1;
  return (
    <Card title={t.progress}>
      <ol className="md:grid md:grid-cols-7">
        {view.stages.map((stage, i) => {
          const done = stage.state === "done";
          const current = stage.state === "current";
          return (
            <li
              key={stage.key}
              aria-current={current ? "step" : undefined}
              className="relative flex items-start gap-3 pb-5 last:pb-0 md:flex-col md:items-center md:gap-2 md:pb-0 md:text-center"
            >
              {i < last && (
                <span
                  aria-hidden
                  className={cx(
                    "absolute start-[15px] top-8 bottom-0 w-0.5 md:start-1/2 md:top-[15px] md:bottom-auto md:h-0.5 md:w-full",
                    done ? "bg-brand" : "bg-border",
                  )}
                />
              )}
              <span
                className={cx(
                  "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold",
                  done && "border-brand bg-brand text-brand-foreground",
                  current && "border-brand bg-white text-brand ring-4 ring-brand/15",
                  !done && !current && "border-border bg-white text-muted",
                )}
              >
                {done ? "✓" : i + 1}
              </span>
              <span className="min-w-0 pt-1 md:px-1 md:pt-0">
                <span
                  className={cx(
                    "block text-sm leading-snug",
                    current ? "font-bold text-brand" : done ? "" : "text-muted",
                  )}
                >
                  {stage.label[locale]}
                </span>
                {current && (
                  <span className="mt-1 flex flex-wrap gap-1 md:justify-center">
                    <Badge tone="brand">{t.stepCurrent}</Badge>
                    {view.view.flags.map((flag) => (
                      <Badge key={flag} tone="warning">
                        {CLIENT_FLAG_LABELS[flag][locale]}
                      </Badge>
                    ))}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-sm font-bold">{title}</h3>
      <ul className="list-inside list-disc space-y-0.5 text-sm leading-relaxed">
        {items.map((item, i) => (
          <li key={i} dir="auto">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuoteCard({
  quote,
  view,
  token,
  base,
  locale,
  t,
}: {
  quote: ClientPortalView["quotes"][number];
  view: ClientPortalView;
  token: string;
  base: string;
  locale: Locale;
  t: Dictionary;
}) {
  const money = (minor: number) => <Money minor={minor} currency={quote.currency} locale={locale} />;
  return (
    <Card
      title={
        <>
          {t.quote}: <bdi>{quote.title}</bdi>
        </>
      }
      description={
        <>
          {t.quoteRef} <Ltr>{quote.ref}</Ltr> · {t.version} {quote.version}
          {quote.validUntil && ` · ${t.validUntil} ${formatDate(quote.validUntil, locale)}`}
        </>
      }
      actions={<Badge tone={quoteTone(quote.status)}>{QUOTE_STATUS_LABELS[quote.status][locale]}</Badge>}
    >
      <div className="space-y-5">
        {quote.summary && (
          <p dir="auto" className="text-sm leading-relaxed">
            {quote.summary}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <List title={t.scopeIncluded} items={quote.scopeIncluded} />
          <List title={t.scopeExcluded} items={quote.scopeExcluded} />
          <List title={t.assumptions} items={quote.assumptions} />
          <List title={t.acceptanceCriteria} items={quote.acceptanceCriteria} />
        </div>
        {quote.timeline && (
          <p className="text-sm">
            <span className="font-bold">{t.schedule}: </span>
            <bdi>{quote.timeline}</bdi>
          </p>
        )}

        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted">
                <th className="py-2 text-start font-medium">{t.item}</th>
                <th className="py-2 text-end font-medium">{t.qty}</th>
                <th className="hidden py-2 text-end font-medium sm:table-cell">{t.unitPrice}</th>
                <th className="py-2 text-end font-medium">{t.total}</th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((line, i) => (
                <tr key={i} className="border-b border-border">
                  <td dir="auto" className="py-2 pe-2 text-start">
                    {line.description}
                  </td>
                  <td className="py-2 text-end tabular-nums">{line.quantity}</td>
                  <td className="hidden py-2 text-end sm:table-cell">{money(line.unitPriceMinor)}</td>
                  <td className="py-2 text-end">{money(line.totalMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="ms-auto max-w-xs space-y-1 text-sm">
          {quote.discountMinor > 0 && (
            <>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">{t.subtotal}</dt>
                <dd>{money(quote.subtotalMinor)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">{t.discount}</dt>
                <dd>{money(-quote.discountMinor)}</dd>
              </div>
            </>
          )}
          <div className="flex justify-between gap-4 border-t border-border pt-2 text-base font-bold">
            <dt>{t.grandTotal}</dt>
            <dd>{money(quote.totalMinor)}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted">{t.pricesInclude}</p>

        <div>
          <h3 className="mb-2 text-sm font-bold">{t.paymentPlan}</h3>
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {quote.paymentPlan.map((m, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                <span>
                  {MILESTONE_KIND_LABELS[m.kind][locale]} <span className="text-xs text-muted">({m.percent}%)</span>
                </span>
                {money(m.amountMinor)}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted">{t.finalAfterLast}</p>
        </div>

        <p className="text-sm">{t.revisionsWarranty(quote.revisionsIncluded, quote.warrantyDays)}</p>
        {quote.thirdPartyCosts && (
          <p className="text-sm">
            <span className="font-bold">{t.thirdParty}: </span>
            <bdi>{quote.thirdPartyCosts}</bdi>
          </p>
        )}

        {quote.documentId && (
          <a
            href={`${base}/documents/${quote.documentId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-sm text-brand underline"
          >
            {t.downloadPdf} · <Ltr>{quote.ref}</Ltr>
          </a>
        )}

        {quote.acceptedAt && <Notice tone="success">{t.acceptedOn(formatDate(quote.acceptedAt, locale))}</Notice>}

        {quote.status === "sent" &&
          (view.paymentPolicy.canAcceptQuote ? (
            <div className="border-t border-border pt-4">
              <h3 className="mb-3 font-bold">{t.acceptTitle}</h3>
              <AcceptQuoteForm
                action={acceptQuoteAction.bind(null, token, locale, quote.id)}
                labels={{
                  terms: t.acceptTerms(quote.termsVersion ?? "—"),
                  waiver: t.acceptWaiver,
                  sendCode: t.sendCode,
                  resendCode: t.resendCode,
                  codeLabel: t.codeLabel,
                  confirm: t.confirmAccept,
                  sending: t.sending,
                  confirming: t.confirming,
                }}
              />
            </div>
          ) : (
            view.paymentPolicy.notice && (
              <Notice tone="info" title={t.paymentsSoonTitle}>
                {view.paymentPolicy.notice[locale]}
              </Notice>
            )
          ))}
      </div>
    </Card>
  );
}

function PaymentsCard({
  view,
  base,
  locale,
  t,
}: {
  view: ClientPortalView;
  base: string;
  locale: Locale;
  t: Dictionary;
}) {
  const enabled = view.paymentPolicy.showPaymentLinks;
  if (view.payments.length === 0 && enabled) return null;
  return (
    <Card title={t.payments}>
      {!enabled && (
        <Notice tone="info" title={t.paymentsSoonTitle} className={view.payments.length ? "mb-4" : undefined}>
          {t.paymentsSoon}
        </Notice>
      )}
      {view.payments.length === 0 ? (
        enabled ? (
          <p className="text-sm text-muted">{t.noPayments}</p>
        ) : null
      ) : (
        <ul className="divide-y divide-border">
          {view.payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-medium">{p.label[locale]}</p>
                {p.paidAt && <p className="text-xs text-muted">{t.paidOn(formatDate(p.paidAt, locale))}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Money minor={p.amountMinor} currency={p.currency} locale={locale} className="font-bold" />
                <Badge tone={milestoneTone(p.status)}>{CLIENT_MILESTONE_STATUS[p.status][locale]}</Badge>
                {enabled && p.payUrl && (
                  <a
                    href={p.payUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-9 items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-foreground hover:bg-brand/90"
                  >
                    {t.payNow}
                  </a>
                )}
                {p.receiptDocumentId && (
                  <a
                    href={`${base}/documents/${p.receiptDocumentId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-brand underline"
                  >
                    {t.receipt}
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function FilesCard({
  view,
  token,
  base,
  locale,
  t,
  unlocked,
}: {
  view: ClientPortalView;
  token: string;
  base: string;
  locale: Locale;
  t: Dictionary;
  unlocked: boolean;
}) {
  const previews = view.deliverables.filter((d) => d.kind === "preview" && d.released);
  const finals = view.deliverables.filter((d) => d.kind === "final");
  const releasedFinals = finals.filter((d) => d.released);
  if (previews.length === 0 && finals.length === 0) return null;

  const linkFor = (d: ClientPortalView["deliverables"][number]) =>
    d.hasFile ? `${base}/files/${d.id}` : d.externalUrl;

  return (
    <Card title={t.files}>
      {previews.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 text-sm font-bold">{t.previews}</h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {previews.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <bdi className="min-w-0">{d.title}</bdi>
                {linkFor(d) && (
                  <a
                    href={linkFor(d)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-brand underline"
                  >
                    {t.open}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {finals.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-bold">{t.finals}</h3>
          {releasedFinals.length === 0 ? (
            <Notice tone="info">{t.finalsLocked}</Notice>
          ) : unlocked ? (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {releasedFinals.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <bdi className="min-w-0">{d.title}</bdi>
                  {linkFor(d) && (
                    <a
                      href={linkFor(d)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-brand underline"
                    >
                      {t.download}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="space-y-3">
              <ul className="list-inside list-disc text-sm">
                {releasedFinals.map((d) => (
                  <li key={d.id}>{d.title}</li>
                ))}
              </ul>
              <p className="text-sm text-muted">{t.finalsNeedCode}</p>
              <UnlockFinalsForm
                action={unlockFinalsAction.bind(null, token, locale)}
                labels={{
                  sendCode: t.sendCode,
                  resendCode: t.resendCode,
                  codeLabel: t.codeLabel,
                  unlock: t.unlock,
                  sending: t.sending,
                  confirming: t.confirming,
                }}
              />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function TimelineCard({ view, locale, t }: { view: ClientPortalView; locale: Locale; t: Dictionary }) {
  return (
    <Card title={t.timeline}>
      {view.timeline.length === 0 ? (
        <p className="text-sm text-muted">{t.noTimeline}</p>
      ) : (
        <ol>
          {[...view.timeline].reverse().map((item, i) => (
            <li key={i} className="relative border-s-2 border-border ps-4 pb-4 last:pb-0">
              <span aria-hidden className="absolute -start-[5px] top-1.5 size-2 rounded-full bg-brand" />
              <p dir="auto" className="text-sm leading-relaxed">
                {item.message[locale]}
              </p>
              <p className="text-xs text-muted">{formatDate(item.at, locale)}</p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function ContactCard({ t }: { t: Dictionary }) {
  const wa = whatsappUrl();
  return (
    <Card>
      <p className="font-bold">{t.contact}</p>
      <p className="mt-1 text-sm text-muted">{t.contactText}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {wa && (
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-border px-3 py-1 hover:border-brand"
          >
            {t.whatsapp}
          </a>
        )}
        <a
          href={`mailto:${brand.contact.email}`}
          className="rounded-full border border-border px-3 py-1 hover:border-brand"
        >
          {t.email}: <Ltr>{brand.contact.email}</Ltr>
        </a>
      </div>
    </Card>
  );
}
