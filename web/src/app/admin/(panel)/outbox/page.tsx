import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge, Card, EmptyState, Ltr, Notice, PageHeader } from "@/components/ui";
import { isProduction } from "@/config/env";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/next-session";
import { listOutbox } from "@/lib/email/send";
import { formatDateTime } from "@/lib/ui/format";

export const metadata: Metadata = { title: "صندوق الصادر" };

/** Development only: emails that were logged instead of sent (no RESEND_API_KEY). */
export default async function OutboxPage() {
  await requireAdmin();
  if (isProduction()) notFound();
  const mails = await listOutbox(getDb(), 50);

  return (
    <>
      <PageHeader title="صندوق الصادر (تطوير)" subtitle="آخر 50 رسالة سُجّلت بدل إرسالها" />
      <Notice tone="warning" className="mb-6">
        هذه الصفحة للتطوير فقط ولا تظهر في الإنتاج. بدون RESEND_API_KEY تُكتب الرسائل (ومنها رموز التحقق) هنا وفي طرفية
        الخادم.
      </Notice>
      {mails.length === 0 ? (
        <EmptyState>لا رسائل بعد.</EmptyState>
      ) : (
        <div className="space-y-3">
          {mails.map((m) => (
            <Card key={m.id} bodyClassName="p-0">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span className="min-w-0">
                    <span className="font-medium">{m.subject}</span>
                    <span className="block text-xs text-muted">
                      إلى <Ltr>{m.toEmail}</Ltr> · {formatDateTime(m.createdAt)}
                    </span>
                  </span>
                  {m.tag && <Badge tone="info">{m.tag}</Badge>}
                </summary>
                <pre className="overflow-x-auto whitespace-pre-wrap border-t border-border bg-surface px-4 py-3 font-sans text-sm leading-relaxed">
                  {m.textBody}
                </pre>
              </details>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
