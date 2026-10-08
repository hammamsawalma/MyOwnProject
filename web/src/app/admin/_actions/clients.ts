"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/next-session";
import { CLIENT_TYPES, LANGUAGES, PACKAGE_TIERS, PRICING_MODELS } from "@/lib/domain-enums";
import { CURRENCIES } from "@/lib/money";
import { createClient, createProject, updateClient } from "@/lib/services/projects";
import type { ActionState } from "@/lib/ui/action-state";
import { runAction } from "@/lib/ui/errors";
import { oneOf, optStr, str } from "@/lib/ui/form";

function clientInput(fd: FormData) {
  return {
    name: str(fd, "name"),
    type: oneOf(fd, "type", CLIENT_TYPES, "individual"),
    companyName: optStr(fd, "companyName"),
    email: optStr(fd, "email"),
    phoneE164: optStr(fd, "phoneE164")?.replace(/[\s-]/g, "") ?? null,
    country: optStr(fd, "country")?.toUpperCase() ?? null,
    language: oneOf(fd, "language", LANGUAGES, "ar"),
    taxId: optStr(fd, "taxId"),
    segment: optStr(fd, "segment"),
    source: optStr(fd, "source"),
    notes: optStr(fd, "notes"),
  };
}

export async function createClientAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  let clientId = "";
  const result = await runAction(async () => {
    clientId = (await createClient(getDb(), clientInput(fd))).id;
  });
  if (result.status === "error") return result;
  redirect(`/admin/clients/${clientId}`);
}

export async function updateClientAction(clientId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  return runAction(async () => {
    await updateClient(getDb(), clientId, clientInput(fd));
    revalidatePath(`/admin/clients/${clientId}`);
    return { status: "ok", message: "حُفظت بيانات العميل." };
  });
}

export async function createProjectAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  let projectId = "";
  const result = await runAction(async () => {
    const pricingModel = oneOf(fd, "pricingModel", PRICING_MODELS, "custom");
    const project = await createProject(getDb(), {
      clientId: str(fd, "clientId"),
      title: str(fd, "title"),
      serviceKey: optStr(fd, "serviceKey"),
      pricingModel,
      packageTier: pricingModel === "package" ? oneOf(fd, "packageTier", PACKAGE_TIERS, "standard") : null,
      currency: oneOf(fd, "currency", CURRENCIES, "USD"),
      source: optStr(fd, "source"),
    });
    projectId = project.id;
  });
  if (result.status === "error") return result;
  redirect(`/admin/projects/${projectId}`);
}
