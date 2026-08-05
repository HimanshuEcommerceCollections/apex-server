import type { ConfigApplies, ConfigInputType, ConfigStatus, PricingMode, ServiceStatus } from "../../../enums";

export interface ConfigOptionView {
  id: string;
  key: string;
  label: string;
  sublabel: string | null;
  priceDelta: number;
  sortOrder: number;
  status: ConfigStatus;
}

export interface ConfigGroupView {
  id: string;
  serviceId: string;
  key: string;
  label: string;
  description: string | null; // admin-written blurb shown under the label
  inputType: ConfigInputType;
  uiHint: string | null;
  applies: ConfigApplies;
  isRequired: boolean;
  priceDelta: number | null;
  selectMin: number | null;
  selectMax: number | null;
  // QUANTITY groups: numeric bounds + the pricing strategy (quantity × unitPrice).
  quantityMin: number | null;
  quantityMax: number | null;
  unitLabel: string | null; // e.g. "per hour"
  unitPrice: number | null; // cents per unit
  sortOrder: number;
  status: ConfigStatus;
  options: ConfigOptionView[];
}

/** One active cadence offer on a service — the /book frequency section. */
export interface RecurringOfferView {
  cadenceId: string;
  key: string; // "one-time", "weekly", …
  label: string;
  discountPercent: number; // % off the configured pre-tax total
}

export interface ServiceConfigResponse {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  summary: string | null;
  description: string | null;
  pricingMode: PricingMode;
  pricingRef: string;
  basePrice: number;
  fromPrice: number | null; // basePrice when > 0 (wire name kept); the listed "from $X" minimum
  currency: string;
  badges: string[];
  claimsBlock: string | null;
  isRecurringEligible: boolean;
  sortOrder: number;
  status: ServiceStatus;
  taxRateBps: number; // basis points; applied at checkout, never in the configurator
  configGroups: ConfigGroupView[];
  recurring: RecurringOfferView[];
}
