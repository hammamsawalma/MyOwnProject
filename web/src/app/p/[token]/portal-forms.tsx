"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ActionForm, SubmitButton } from "@/components/client";
import { Checkbox, Input } from "@/components/ui";
import type { ActionState, FormAction } from "@/lib/ui/action-state";

/** Keeps <html lang/dir> in sync when the tracking page is shown in English. */
export function DocumentLanguage({ locale }: { locale: "ar" | "en" }) {
  useEffect(() => {
    const root = document.documentElement;
    const previous = { lang: root.lang, dir: root.dir };
    root.lang = locale;
    root.dir = locale === "en" ? "ltr" : "rtl";
    return () => {
      root.lang = previous.lang;
      root.dir = previous.dir;
    };
  }, [locale]);
  return null;
}

function CodeField({ label }: { label: string }) {
  return (
    <div className="max-w-xs">
      <label htmlFor="otp-code" className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <Input
        id="otp-code"
        name="code"
        dir="ltr"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9٠-٩ ]{6,7}"
        maxLength={7}
        required
        className="text-center font-mono text-lg tracking-[0.4em]"
      />
    </div>
  );
}

export interface AcceptLabels {
  terms: ReactNode;
  waiver: string;
  sendCode: string;
  resendCode: string;
  codeLabel: string;
  confirm: string;
  sending: string;
  confirming: string;
}

export function AcceptQuoteForm({ action, labels }: { action: FormAction; labels: AcceptLabels }) {
  const [codeSent, setCodeSent] = useState(false);
  const onResult = (state: ActionState) => {
    if (state.status === "ok" && state.data?.codeSent) setCodeSent(true);
  };
  return (
    <ActionForm action={action} onResult={onResult} className="space-y-4">
      <div className="space-y-3 rounded-lg bg-surface p-3">
        <Checkbox name="terms" required label={labels.terms} />
        <Checkbox name="waiver" required label={labels.waiver} />
      </div>
      {codeSent && <CodeField label={labels.codeLabel} />}
      <div className="flex flex-wrap items-center gap-2">
        {codeSent ? (
          <>
            <SubmitButton name="intent" value="accept" pendingLabel={labels.confirming}>
              {labels.confirm}
            </SubmitButton>
            <SubmitButton name="intent" value="send_code" variant="ghost" size="sm" formNoValidate>
              {labels.resendCode}
            </SubmitButton>
          </>
        ) : (
          <SubmitButton name="intent" value="send_code" pendingLabel={labels.sending}>
            {labels.sendCode}
          </SubmitButton>
        )}
      </div>
    </ActionForm>
  );
}

export interface UnlockLabels {
  sendCode: string;
  resendCode: string;
  codeLabel: string;
  unlock: string;
  sending: string;
  confirming: string;
}

export function UnlockFinalsForm({ action, labels }: { action: FormAction; labels: UnlockLabels }) {
  const [codeSent, setCodeSent] = useState(false);
  const onResult = (state: ActionState) => {
    if (state.status === "ok" && state.data?.codeSent) setCodeSent(true);
  };
  return (
    <ActionForm action={action} onResult={onResult} className="space-y-3">
      {codeSent && <CodeField label={labels.codeLabel} />}
      <div className="flex flex-wrap items-center gap-2">
        {codeSent ? (
          <>
            <SubmitButton name="intent" value="verify" pendingLabel={labels.confirming}>
              {labels.unlock}
            </SubmitButton>
            <SubmitButton name="intent" value="send_code" variant="ghost" size="sm" formNoValidate>
              {labels.resendCode}
            </SubmitButton>
          </>
        ) : (
          <SubmitButton name="intent" value="send_code" variant="secondary" pendingLabel={labels.sending}>
            {labels.sendCode}
          </SubmitButton>
        )}
      </div>
    </ActionForm>
  );
}
