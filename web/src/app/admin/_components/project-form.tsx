"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/client";
import { Field, Input, Select } from "@/components/ui";
import { createProjectAction } from "../_actions/clients";

export function ProjectForm({
  clients,
  defaultClientId,
}: {
  clients: { id: string; label: string }[];
  defaultClientId?: string;
}) {
  const [pricingModel, setPricingModel] = useState("custom");
  return (
    <ActionForm action={createProjectAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="العميل *" htmlFor="clientId">
          <Select id="clientId" name="clientId" required defaultValue={defaultClientId ?? ""}>
            <option value="" disabled>
              اختر العميل
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="عنوان المشروع *" htmlFor="title">
          <Input id="title" name="title" required />
        </Field>
        <Field label="نوع التسعير" htmlFor="pricingModel">
          <Select
            id="pricingModel"
            name="pricingModel"
            value={pricingModel}
            onChange={(e) => setPricingModel(e.target.value)}
          >
            <option value="custom">عرض مخصص</option>
            <option value="package">باقة ثابتة</option>
          </Select>
        </Field>
        {pricingModel === "package" && (
          <Field label="الباقة" htmlFor="packageTier">
            <Select id="packageTier" name="packageTier" defaultValue="standard">
              <option value="basic">الأساسية (Basic)</option>
              <option value="standard">القياسية (Standard)</option>
              <option value="premium">المتقدمة (Premium)</option>
            </Select>
          </Field>
        )}
        <Field label="العملة" htmlFor="currency">
          <Select id="currency" name="currency" defaultValue="USD">
            <option value="USD">دولار (USD)</option>
            <option value="EUR">يورو (EUR)</option>
          </Select>
        </Field>
        <Field label="رمز الخدمة" htmlFor="serviceKey" hint="اختياري، مثل: whatsapp-ai-receptionist">
          <Input id="serviceKey" name="serviceKey" dir="ltr" />
        </Field>
        <Field label="المصدر" htmlFor="source" hint="من أين جاء الطلب">
          <Input id="source" name="source" />
        </Field>
      </div>
      <SubmitButton pendingLabel="جارٍ الإنشاء…">إنشاء المشروع</SubmitButton>
    </ActionForm>
  );
}
