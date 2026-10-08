"use client";

import { ActionForm, SubmitButton } from "@/components/client";
import { Field, Input } from "@/components/ui";
import { loginAction } from "../_actions/auth";

export function LoginForm() {
  return (
    <ActionForm action={loginAction} className="space-y-4">
      <Field label="البريد الإلكتروني" htmlFor="email">
        <Input id="email" name="email" type="email" dir="ltr" autoComplete="username" required autoFocus />
      </Field>
      <Field label="كلمة المرور" htmlFor="password">
        <Input id="password" name="password" type="password" dir="ltr" autoComplete="current-password" required />
      </Field>
      <SubmitButton className="w-full" pendingLabel="جارٍ الدخول…">
        دخول
      </SubmitButton>
    </ActionForm>
  );
}
