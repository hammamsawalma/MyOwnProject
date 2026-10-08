"use client";

import { ActionForm, CopyButton, SubmitButton } from "@/components/client";
import { Checkbox } from "@/components/ui";
import type { FormAction } from "@/lib/ui/action-state";

export function MagicLinkGenerator({ action, hasActiveLinks }: { action: FormAction; hasActiveLinks: boolean }) {
  return (
    <ActionForm action={action} className="space-y-3" hideMessage>
      {(state) => (
        <>
          <Checkbox name="revokeExisting" defaultChecked={hasActiveLinks} label="إلغاء الروابط النشطة السابقة" />
          <SubmitButton variant="secondary" size="sm" pendingLabel="جارٍ الإنشاء…">
            إنشاء رابط جديد
          </SubmitButton>
          {state.status === "error" && (
            <p role="alert" className="text-sm text-danger">
              {state.message}
            </p>
          )}
          {state.status === "ok" && state.data?.url && (
            <div className="space-y-2 rounded-lg border border-success/30 bg-success-soft/50 p-3">
              <p className="text-xs text-success">{state.message}</p>
              <input
                readOnly
                dir="ltr"
                value={state.data.url}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="رابط التتبع"
                className="h-9 w-full rounded-md border border-border bg-white px-2 font-mono text-xs"
              />
              <CopyButton value={state.data.url} label="نسخ الرابط" copiedLabel="تم النسخ ✓" />
            </div>
          )}
        </>
      )}
    </ActionForm>
  );
}
