import type { CadenceInterval, ConfigInputType, ConfigStatus, PlanPriceType, PricingMode } from "../../enums";

export interface EditOption {
  id: string;
  key: string;
  label: string;
  sublabel: string | null;
  priceDelta: number;
  sortOrder: number;
  status: ConfigStatus;
}

export interface EditGroup {
  id: string;
  key: string;
  label: string;
  description: string | null;
  inputType: ConfigInputType;
  isRequired: boolean;
  selectMin: number | null;
  selectMax: number | null;
  quantityMin: number | null;
  quantityMax: number | null;
  unitLabel: string | null;
  unitPrice: number | null;
  sortOrder: number;
  status: ConfigStatus;
  options: EditOption[];
}

/** One row of the service × cadence grid (every ACTIVE global cadence appears). */
export interface EditRecurringRow {
  cadenceId: string;
  key: string;
  label: string;
  discountPercent: number;
  isActive: boolean;
}

export interface ServiceEditView {
  id: string;
  slug: string;
  name: string;
  pricingMode: PricingMode;
  basePrice: number;
  taxRateBps: number;
  currency: string;
  typicalDuration: string | null;
  groups: EditGroup[];
  recurring: EditRecurringRow[];
}

export interface CadenceView {
  id: string;
  key: string;
  label: string;
  interval: CadenceInterval;
  intervalCount: number;
  sortOrder: number;
  status: ConfigStatus;
}

export interface PlanView {
  id: string;
  serviceId: string;
  serviceName: string;
  serviceSlug: string;
  cadenceId: string;
  cadenceLabel: string;
  name: string;
  bullets: string[];
  price: number;
  priceType: PlanPriceType;
  featured: boolean;
  sortOrder: number;
  status: ConfigStatus;
}
