# تطبيق الويب: لوحة التحكم وبوابة العملاء

تطبيق واحد (Next.js + TypeScript + PostgreSQL) يضم لوحة تحكم صاحب المشروع وبوابة تتبع العملاء. الصفحات العامة للموقع تأتي لاحقًا بعد حسم الاسم. المواصفات المعتمدة: `docs/build/00-mvp-spec.md`، وملاحظات البناء والافتراضات: `docs/build/01-build-notes.md`.

> **البيع مطفأ افتراضيًا** (`SALES_ENABLED=false`): لا روابط دفع ولا أزرار دفع ولا قبول عروض ولا تسجيل دفعات حتى صدور تصريح العمل.

## المتطلبات

- Node.js 22.12 أو أحدث، وpnpm 10 (`corepack enable` يفعّله تلقائيًا من حقل `packageManager`).
- PostgreSQL 16: إما مثبّت محليًا (السكربت `scripts/dev-db.sh`) أو عبر Docker (`docker-compose.yml`).
- Chromium أو Google Chrome لتوليد ملفات PDF (المسار في `CHROMIUM_PATH`، والتطبيق لا ينزّل أي متصفح).

## التشغيل لأول مرة

```bash
cd web
pnpm install
cp .env.example .env            # ثم املأ APP_SECRET وADMIN_EMAIL وCHROMIUM_PATH
pnpm hash-password              # يطبع سطر ADMIN_PASSWORD_HASH جاهزًا للصقه في .env

pnpm db:start                   # PostgreSQL محلي على المنفذ 54329 (أو: docker compose up -d db)
pnpm db:migrate                 # إنشاء الجداول
pnpm db:seed                    # عميل ومشروع تجريبيان يمران بالمراحل حتى "الضمان"
pnpm dev                        # http://localhost:3000
```

ملاحظة عن `ADMIN_PASSWORD_HASH`: Next.js يفسّر علامة `$` داخل `.env`، لذلك يُحفظ الهاش بصيغة `\$argon2id\$...` كما يطبعه `pnpm hash-password`. لا تلصق الهاش بدون الشرطات المائلة.

## الأوامر

| الأمر | الوظيفة |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | التطوير / البناء / التشغيل |
| `pnpm typecheck` | فحص الأنواع (TypeScript strict) |
| `pnpm lint` | ESLint بلا أي تحذيرات |
| `pnpm test` | اختبارات الوحدة (منطق نقي بلا قاعدة بيانات) |
| `pnpm test:integration` | اختبارات التكامل على PostgreSQL حقيقي (قاعدة `studio_test`، تُمسح في كل تشغيل) |
| `pnpm test:all` | الاثنان معًا |
| `pnpm db:start` / `db:stop` / `db:status` / `db:psql` | إدارة قاعدة البيانات المحلية |
| `pnpm db:generate` | توليد ملف ترحيل (migration) بعد تعديل `src/db/schema.ts` |
| `pnpm db:migrate` | تطبيق الترحيلات |
| `pnpm db:seed [-- --until=quote_sent]` | بيانات تجريبية حتى مرحلة معيّنة |
| `pnpm db:reset` | قاعدة جديدة فارغة + ترحيل + بيانات تجريبية |

## البنية

```
src/
  config/      brand.ts (البراند من مكان واحد) · env.ts · policy.ts · routes.ts
  db/          schema.ts (كل الجداول) · client.ts
  lib/         المنطق الأساسي:
    project-status.ts   16 حالة داخلية + 4 جانبية، والانتقالات، والربط بالمراحل السبع للعميل
    money.ts            المبالغ بوحدات صغرى (سنتات)، دولار ويورو فقط
    payment-plan.ts     سياسة الدفعات الافتراضية (100% / 50-50 / 30-40-30) قابلة للتعديل
    numbering.ts        ترقيم بلا فجوات Q/R/CN/P-YYYY-NNNN
    magic-links.ts      روابط التتبع السرية (256 بت، الهاش فقط، صلاحية، إلغاء، تحديد معدل)
    otp.ts              رموز التحقق لمرة واحدة (6 أرقام، 10 دقائق، 5 محاولات)
    sales.ts            مفتاح إيقاف البيع
    auth/               دخول المدير (argon2id، جلسات، تحديد معدل)
    email/              Resend أو صندوق صادر للتطوير
    pdf/                HTML إلى PDF عبر Chromium بخط عربي مضمّن
    services/           العمليات: المشاريع، العروض، الدفعات، المستندات، التسليمات، التكاليف، البوابة، لوحة "اليوم"
drizzle/       ملفات الترحيل (SQL)، ومنها مشغّلات قاعدة البيانات التي تمنع تعديل المستندات المُصدرة
scripts/       dev-db.sh · migrate.ts · seed.ts · hash-password.ts
tests/         unit/ · integration/
```

## قواعد للمطوّرين (ولوكلاء البناء)

- **تغيير حالة المشروع** يتم فقط عبر `transitionProject()`؛ فهي تتحقق من الانتقال المسموح والشروط وتسجل الحدث في الخط الزمني.
- **أي عملية مالية** (قبول عرض، إرسال رابط دفع، تسجيل دفعة، إيصال) تمر عبر `assertSalesEnabled()`؛ وصفحة العميل تأخذ بياناتها من `getClientPortalView()` الذي يحجب روابط الدفع حين يكون البيع مطفأ.
- **المستندات المُصدرة لا تُعدّل** (مشغّل في قاعدة البيانات يرفض ذلك)؛ التصحيح بإشعار دائن `issueCreditNote()`.
- **الواجهة**: نصوص عربية، واتجاه RTL، واستعمال الأدوات المنطقية في Tailwind (`ms-*`، `me-*`، `ps-*`، `pe-*`، `text-start`) بدل left/right. ألوان البراند متاحة كأصناف `bg-brand` و`text-brand` و`border-border`.
- **صفحات العميل** تحت `/p/<الرمز>`، وصفحات المدير تحت `/admin`؛ رؤوس `noindex` و`Referrer-Policy: no-referrer` مضبوطة مسبقًا في `next.config.ts`.
- في كل صفحة أو إجراء للمدير: `await requireAdmin()` من `src/lib/auth/next-session.ts`.
