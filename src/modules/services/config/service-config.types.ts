import type { Prisma } from "@prisma/client";
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
  inputType: ConfigInputType;
  uiHint: string | null;
  applies: ConfigApplies;
  isRequired: boolean;
  priceDelta: number | null;
  selectMin: number | null;
  selectMax: number | null;
  sortOrder: number;
  status: ConfigStatus;
  options: ConfigOptionView[];
}

export interface RuleView {
  key: string;
  label: string;
  trigger: Prisma.JsonValue;
  effect: Prisma.JsonValue;
  sortOrder: number;
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
  configGroups: ConfigGroupView[];
  rules: RuleView[];
}
