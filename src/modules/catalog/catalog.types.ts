import type { PricingMode } from "../../enums";

export interface EditOption {
  id: string;
  key: string;
  label: string;
  priceDelta: number;
  status: string;
}
export interface EditGroup {
  key: string;
  label: string;
  inputType: string;
  status: string;
  options: EditOption[];
}
export interface EditRule {
  id: string;
  key: string;
  label: string;
  kind: string; // "discount" | "fee"
  calc: string; // "percent" | "flat"
  value: number;
}
export interface RecurringPlanEditView {
  id: string;
  name: string;
  freq: string;
  amount: string;
  unit: string | null;
  disc: string | null;
  best: boolean;
  cta: string;
}
export interface RecurringEditView {
  serviceSlug: string;
  serviceName: string;
  heading: string | null;
  plans: RecurringPlanEditView[];
}
export interface ServiceEditView {
  id: string;
  slug: string;
  name: string;
  pricingMode: PricingMode;
  basePrice: number;
  fromPrice: number | null;
  currency: string;
  typicalDuration: string | null;
  recurringDiscount: string | null;
  groups: EditGroup[];
  rules: EditRule[];
}
