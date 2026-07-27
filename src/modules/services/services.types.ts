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
  status: ServiceStatus;
  sortOrder: number;
  category: { slug: string; name: string } | null;
}

export interface ServiceDetail extends ServiceListItem {
  categoryId: string;
  description: string | null;
  pricingRef: string;
  basePrice: number;
  claimsBlock: string | null;
}
