import type { PricingMode, ServiceStatus } from "../../enums";

export interface ServiceListItem {
  id: string;
  name: string;
  slug: string;
  summary: string | null;
  pricingMode: PricingMode;
  fromPrice: number | null; // basePrice when > 0 (wire name kept); the listed "from $X" minimum
  currency: string;
  badges: string[];
  isRecurringEligible: boolean;
  typicalDuration: string | null;
  recurringDiscount: string | null;
  status: ServiceStatus;
  sortOrder: number;
  category: { slug: string; name: string } | null;
}

/**
 * One payment frequency this service offers, from the admin's Recurring grid.
 *
 * This is NOT a ServicePlan — there is no package, nothing to buy here, and no
 * CTA. The service page renders these as display-only cards ("here is what
 * committing to a frequency saves you"); the actual choice is made in the
 * estimator's Frequency control, which is driven by this same list.
 */
export interface RecurringOptionView {
  cadenceId: string;
  key: string; // "one-time", "weekly", …
  label: string; // "Weekly"
  freq: string; // "Every week", "Every 2 weeks" — the card's sub-line
  discountPercent: number; // the raw % the estimator applies
  disc: string | null; // "Save 20%", or null at 0%
  amount: string | null; // base price with the discount applied; null if no from-price
  unit: string | null; // "/visit" when an amount is shown
  isSubscription: boolean; // interval !== NONE — picking it starts a subscription
  best: boolean; // deepest discount on offer
}

export interface ServiceDetail extends ServiceListItem {
  categoryId: string;
  description: string | null;
  pricingRef: string;
  basePrice: number;
  claimsBlock: string | null;
  recurringHeading: string | null;
  recurringOptions: RecurringOptionView[];
}
