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
export interface ServiceEditView {
  id: string;
  slug: string;
  name: string;
  pricingMode: PricingMode;
  basePrice: number;
  fromPrice: number | null;
  currency: string;
  groups: EditGroup[];
  rules: EditRule[];
}
