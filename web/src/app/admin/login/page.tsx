import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { brand } from "@/config/brand";
import { ADMIN_PREFIX } from "@/config/routes";
import { getCurrentAdminSession } from "@/lib/auth/next-session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "تسجيل الدخول" };

export default async function LoginPage() {
  if (await getCurrentAdminSession()) redirect(ADMIN_PREFIX);

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-xs tracking-widest text-muted">{brand.logoText.ar}</p>
          <h1 className="mt-1 text-2xl font-bold text-brand">لوحة التحكم</h1>
          <p className="mt-1 text-sm text-muted">{brand.name.ar}</p>
        </div>
        <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
