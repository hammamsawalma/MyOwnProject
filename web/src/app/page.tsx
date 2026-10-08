import { brand, whatsappUrl } from "@/config/brand";

// Placeholder until the brand name is chosen (public pages come in build phase 2).
// No prices, no order or payment buttons: sales stay off until the work permit.
export default function HomePage() {
  const wa = whatsappUrl();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 py-16 text-center">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-white px-6 py-12 shadow-sm sm:px-10">
        <p className="text-sm tracking-widest text-muted">{brand.logoText.ar}</p>
        <h1 className="mt-2 text-3xl font-bold text-brand sm:text-4xl">{brand.name.ar}</h1>
        <p className="mt-3 text-lg">{brand.tagline.ar}</p>
        <p className="mx-auto mt-8 inline-flex items-center gap-2 rounded-full bg-brand/10 px-5 py-2 text-xl font-bold text-brand">
          قريبًا
        </p>
        <p className="mt-4 text-muted">نجهّز الموقع الآن. يسعدنا تواصلك في أي وقت.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2 text-sm">
          <a
            href={`mailto:${brand.contact.email}`}
            className="rounded-full border border-border px-4 py-2 hover:border-brand"
          >
            <bdi dir="ltr">{brand.contact.email}</bdi>
          </a>
          {wa && (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-border px-4 py-2 hover:border-brand"
            >
              واتساب
            </a>
          )}
        </div>
        <p lang="en" dir="ltr" className="mt-10 text-sm text-muted">
          {brand.name.en} · {brand.tagline.en} · Coming soon
        </p>
      </div>
    </main>
  );
}
