"use server";

import { redirect } from "next/navigation";
import { ADMIN_LOGIN_PATH, ADMIN_PREFIX } from "@/config/routes";
import { getDb } from "@/db/client";
import { loginAdmin } from "@/lib/auth/admin";
import { logoutAdmin, requestContext, setAdminSessionCookie } from "@/lib/auth/next-session";
import type { ActionState } from "@/lib/ui/action-state";
import { formatDateTime } from "@/lib/ui/format";
import { str } from "@/lib/ui/form";

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const password = formData.get("password");
  const result = await loginAdmin(getDb(), {
    email: str(formData, "email"),
    password: typeof password === "string" ? password : "",
    ...(await requestContext()),
  });

  if (!result.ok) {
    switch (result.reason) {
      case "rate_limited":
        return { status: "error", message: `محاولات فاشلة كثيرة. حاول بعد ${formatDateTime(result.retryAt)}.` };
      case "not_configured":
        return {
          status: "error",
          message: "الدخول غير مُعدّ: اضبط ADMIN_EMAIL وADMIN_PASSWORD_HASH في ملف .env (راجع web/README.md).",
        };
      default:
        return { status: "error", message: "البريد أو كلمة المرور غير صحيحة." };
    }
  }

  await setAdminSessionCookie(result.sessionToken, result.expiresAt);
  redirect(ADMIN_PREFIX);
}

export async function logoutAction(): Promise<void> {
  await logoutAdmin();
  redirect(ADMIN_LOGIN_PATH);
}
