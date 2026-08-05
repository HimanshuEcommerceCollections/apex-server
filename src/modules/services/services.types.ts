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

/** Admin-composed Plan on the legacy card wire shape (marketing pages render it as-is). */
export interface RecurringPlanView {
  id: string;
  name: string;
  freq: string; // cadence label
  amount: string; // "$X" — the plan's BINDING pre-tax price, formatted
  unit: string | null; // from priceType: "/visit", "/mo", or null
  disc: string | null; // "Save X%" from the service's cadence discount
  best: boolean; // ServicePlan.featured
  cta: string;
  bullets: string[]; // up to 4 admin-written points
}

export interface ServiceDetail extends ServiceListItem {
  categoryId: string;
  description: string | null;
  pricingRef: string;
  basePrice: number;
  claimsBlock: string | null;
  recurringHeading: string | null;
  recurringPlans: RecurringPlanView[];
}
