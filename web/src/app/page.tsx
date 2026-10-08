import { brand } from "@/config/brand";

// Placeholder until the brand name is chosen (public pages come in build phase 2).
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm tracking-widest text-muted">{brand.logoText.ar}</p>
      <h1 className="text-3xl font-bold text-brand">{brand.name.ar}</h1>
      <p className="text-lg">{brand.tagline.ar}</p>
      <p className="text-muted">الموقع قيد الإنشاء.</p>
    </main>
  );
}
