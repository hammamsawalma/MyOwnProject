import type { ReactNode } from "react";
import { brand } from "@/config/brand";
import { isProduction } from "@/config/env";
import { requireAdmin } from "@/lib/auth/next-session";
import { getSalesConfig } from "@/lib/sales";
import { logoutAction } from "../_actions/auth";
import { AdminNav, type NavItem } from "../_components/admin-nav";

export default async function AdminPanelLayout({ children }: { children: ReactNode }) {
  // Layouts are not a security boundary on their own: every page and action also calls requireAdmin().
  await requireAdmin();
  const { salesEnabled } = getSalesConfig();

  const items: NavItem[] = [
    { href: "/admin", label: "اليوم" },
    { href: "/admin/projects", label: "المشاريع" },
    { href: "/admin/clients", label: "العملاء" },
    { href: "/admin/costs", label: "التكاليف" },
    ...(isProduction() ? [] : [{ href: "/admin/outbox", label: "صندوق الصادر (تطوير)" }]),
    { href: "/admin/settings", label: "الإعدادات" },
  ];

  return (
    <div className="min-h-screen bg-surface lg:flex">
      <aside className="bg-brand text-white lg:w-60 lg:shrink-0">
        <div className="lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
          <div className="px-4 pt-4 pb-3 lg:pt-6">
            <p className="text-xs tracking-widest text-white/60">{brand.logoText.ar}</p>
            <p className="font-bold">لوحة التحكم</p>
          </div>
          <div className="px-4 pb-3 lg:flex-1 lg:px-3">
            <AdminNav items={items} />
          </div>
          <form action={logoutAction} className="hidden px-3 pb-6 lg:block">
            <button
              type="submit"
              className="w-full rounded-lg px-3 py-2 text-start text-sm text-white/75 hover:bg-white/10 hover:text-white"
            >
              تسجيل الخروج
            </button>
          </form>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {!salesEnabled && (
          <div className="border-b border-warning/20 bg-warning-soft px-4 py-2 text-sm text-warning lg:px-8">
            <strong>البيع مطفأ</strong> (SALES_ENABLED=false): لا روابط دفع ولا قبول عروض ولا تسجيل دفعات حتى صدور
            التصريح. الإعداد وصياغة المسودات مسموحان.
          </div>
        )}
        <main className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-8">{children}</main>
        <form action={logoutAction} className="px-4 pb-8 lg:hidden">
          <button type="submit" className="text-sm text-muted underline">
            تسجيل الخروج
          </button>
        </form>
      </div>
    </div>
  );
}
