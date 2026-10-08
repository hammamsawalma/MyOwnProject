"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/next-session";
import { COST_CATEGORIES, RECURRENCES } from "@/lib/domain-enums";
import { CURRENCIES } from "@/lib/money";
import { createCost, deleteCost } from "@/lib/services/costs";
import type { ActionState } from "@/lib/ui/action-state";
import { runAction } from "@/lib/ui/errors";
import { money, oneOf, optStr, str } from "@/lib/ui/form";

export async function createCostAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  return runAction(async () => {
    const currency = oneOf(fd, "currency", CURRENCIES);
    const recurring = oneOf(fd, "recurring", RECURRENCES, "none");
    await createCost(getDb(), {
      incurredOn: str(fd, "incurredOn"),
      category: oneOf(fd, "category", COST_CATEGORIES),
      vendor: str(fd, "vendor"),
      description: optStr(fd, "description"),
      amountMinor: money(fd, "amount", currency),
      currency,
      projectId: optStr(fd, "projectId"),
      campaign: optStr(fd, "campaign"),
      recurring,
      renewsOn: recurring === "none" ? null : optStr(fd, "renewsOn"),
      notes: optStr(fd, "notes"),
    });
    revalidatePath("/admin/costs");
    return { status: "ok", message: "أُضيفت التكلفة." };
  });
}

export async function deleteCostAction(costId: string): Promise<ActionState> {
  await requireAdmin();
  return runAction(async () => {
    await deleteCost(getDb(), costId);
    revalidatePath("/admin/costs");
  });
}
