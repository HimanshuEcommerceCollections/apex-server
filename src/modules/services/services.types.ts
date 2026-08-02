import type { PricingMode, ServiceStatus } from "../../enums";

export interface ServiceListItem {
  id: string;
  name: string;
  slug: string;
  summary: string | null;
  pricingMode: PricingMode;
  fromPrice: number | null;
  currency: string;
  badges: string[];
  isRecurringEligible: boolean;
  typicalDuration: string | null;
  recurringDiscount: string | null;
  status: ServiceStatus;
  sortOrder: number;
  category: { slug: string; name: string } | null;
}

export interface RecurringPlanView {
  id: string;
  name: string;
  freq: string;
  amount: string;
  unit: string | null;
  disc: string | null;
  best: boolean;
  cta: string;
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
