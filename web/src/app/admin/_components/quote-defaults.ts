import type { changeRequests, projects, quoteLineItems, quotes } from "@/db/schema";
import type { QuoteBuilderDefaults } from "./quote-builder";

type Project = typeof projects.$inferSelect;
type Quote = typeof quotes.$inferSelect;
type Line = typeof quoteLineItems.$inferSelect;
type ChangeRequest = typeof changeRequests.$inferSelect;

/** Builder values from an existing quote (editing a draft, or a new version based on the last one). */
export function defaultsFromQuote(quote: Quote, lines: Line[], keepPlan: boolean): QuoteBuilderDefaults {
  return {
    kind: quote.kind,
    changeRequestId: null,
    pricingModel: quote.pricingModel,
    packageTier: quote.packageTier,
    currency: quote.currency,
    title: quote.title,
    summary: quote.summary ?? "",
    scopeIncluded: quote.scopeIncluded,
    scopeExcluded: quote.scopeExcluded,
    assumptions: quote.assumptions,
    acceptanceCriteria: quote.acceptanceCriteria,
    timeline: quote.timeline ?? "",
    revisionsIncluded: quote.revisionsIncluded,
    warrantyDays: quote.warrantyDays,
    thirdPartyCosts: quote.thirdPartyCosts ?? "",
    notes: quote.notes ?? "",
    discountMinor: quote.discountMinor,
    lineItems: lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
    })),
    paymentPlan: keepPlan ? quote.paymentPlan : null,
  };
}

export function blankDefaults(
  project: Project,
  kind: "initial" | "addon",
  changeRequest?: ChangeRequest,
): QuoteBuilderDefaults {
  const addon = kind === "addon";
  return {
    kind,
    changeRequestId: changeRequest?.id ?? null,
    pricingModel: addon ? "custom" : project.pricingModel,
    packageTier: addon ? null : project.packageTier,
    currency: project.currency,
    title: addon ? `إضافة: ${changeRequest?.description.split("\n")[0]?.slice(0, 80) ?? project.title}` : project.title,
    summary: "",
    scopeIncluded: changeRequest ? [changeRequest.description] : [],
    scopeExcluded: [],
    assumptions: [],
    acceptanceCriteria: [],
    timeline: "",
    revisionsIncluded: 0,
    warrantyDays: addon ? project.warrantyDays : 0,
    thirdPartyCosts: "",
    notes: "",
    discountMinor: 0,
    lineItems: [
      {
        description: changeRequest ? (changeRequest.description.split("\n")[0] ?? "") : "",
        quantity: 1,
        unitPriceMinor: 0,
      },
    ],
    paymentPlan: null,
  };
}
