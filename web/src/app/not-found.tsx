import Link from "next/link";
import { brand } from "@/config/brand";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-surface px-4 text-center">
      <p className="text-sm tracking-widest text-muted">{brand.logoText.ar}</p>
      <h1 className="text-2xl font-bold">الصفحة غير موجودة</h1>
      <p className="text-muted">تأكد من الرابط، أو ارجع إلى الصفحة الرئيسية.</p>
      <Link href="/" className="mt-2 text-brand underline">
        الصفحة الرئيسية
      </Link>
    </main>
  );
}
