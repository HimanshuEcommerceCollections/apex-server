import type { CoverageEffect } from "../../enums";

export interface AvailabilityResult {
  zip: string;
  eligible: boolean;
  area: { name: string; slug: string } | null;
  reason: string | null;
}

export interface ZipOverrideInput {
  zipCodeId: string;
  effect: CoverageEffect;
}

export interface CoverageView {
  serviceId: string;
  grantedAreaIds: string[];
  overrides: ZipOverrideInput[];
}
