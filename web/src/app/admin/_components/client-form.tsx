"use client";

import { ActionForm, SubmitButton } from "@/components/client";
import { Field, Input, Select, Textarea } from "@/components/ui";
import type { FormAction } from "@/lib/ui/action-state";

export interface ClientFormValues {
  name: string;
  type: "individual" | "company";
  companyName: string | null;
  email: string | null;
  phoneE164: string | null;
  country: string | null;
  language: "ar" | "en";
  taxId: string | null;
  segment: string | null;
  source: string | null;
  notes: string | null;
}

export function ClientForm({
  action,
  values,
  submitLabel,
}: {
  action: FormAction;
  values?: Partial<ClientFormValues>;
  submitLabel: string;
}) {
  const v = values ?? {};
  return (
    <ActionForm action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="الاسم *" htmlFor="name">
          <Input id="name" name="name" required defaultValue={v.name ?? ""} />
        </Field>
        <Field label="النوع" htmlFor="type">
          <Select id="type" name="type" defaultValue={v.type ?? "individual"}>
            <option value="individual">فرد</option>
            <option value="company">شركة</option>
          </Select>
        </Field>
        <Field label="اسم الشركة" htmlFor="companyName">
          <Input id="companyName" name="companyName" defaultValue={v.companyName ?? ""} />
        </Field>
        <Field label="البريد الإلكتروني" htmlFor="email" hint="ضروري لرموز التحقق ورابط التتبع">
          <Input id="email" name="email" type="email" dir="ltr" defaultValue={v.email ?? ""} />
        </Field>
        <Field label="الهاتف / واتساب" htmlFor="phoneE164" hint="بصيغة دولية: ‎+966500000000">
          <Input id="phoneE164" name="phoneE164" dir="ltr" inputMode="tel" defaultValue={v.phoneE164 ?? ""} />
        </Field>
        <Field label="البلد" htmlFor="country" hint="رمز من حرفين: SA، AE، TR، DE…">
          <Input id="country" name="country" dir="ltr" maxLength={2} defaultValue={v.country ?? ""} />
        </Field>
        <Field label="لغة التواصل" htmlFor="language" hint="لغة الرسائل؛ صفحة التتبع عربية افتراضيًا">
          <Select id="language" name="language" defaultValue={v.language ?? "ar"}>
            <option value="ar">العربية</option>
            <option value="en">الإنجليزية</option>
          </Select>
        </Field>
        <Field label="الرقم الضريبي" htmlFor="taxId">
          <Input id="taxId" name="taxId" dir="ltr" defaultValue={v.taxId ?? ""} />
        </Field>
        <Field label="الشريحة" htmlFor="segment" hint="مثل: عيادات، متاجر، طلاب">
          <Input id="segment" name="segment" defaultValue={v.segment ?? ""} />
        </Field>
        <Field label="المصدر" htmlFor="source" hint="مثل: واتساب، إعلان ميتا، إحالة">
          <Input id="source" name="source" defaultValue={v.source ?? ""} />
        </Field>
      </div>
      <Field label="ملاحظات داخلية" htmlFor="notes">
        <Textarea id="notes" name="notes" defaultValue={v.notes ?? ""} />
      </Field>
      <SubmitButton pendingLabel="جارٍ الحفظ…">{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
