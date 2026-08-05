import type { CadenceInterval, MembershipStatus } from "../../enums";

/**
 * Public membership-plans wire — field names kept from the MembershipPlan era so
 * the marketing /membership-plans page keeps working: `fromPrice` carries the
 * plan's BINDING per-cycle price (no longer a display teaser).
 */
export interface PlanView {
  id: string;
  key: string; // plan id (the old MembershipPlan.key column is gone)
  name: string;
  description: string | null;
  interval: CadenceInterval;
  intervalCount: number;
  fromPrice: number; // cents; the BINDING per-cycle amount (wire name kept)
  currency: string;
  bullets: string[]; // up to 4 admin-written feature points
  active: boolean;
  service: { slug: string; name: string } | null;
}

export interface MembershipView {
  id: string;
  status: MembershipStatus;
  plan: { id: string; name: string } | null;
  service: { slug: string; name: string } | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  lastAmount: number | null;
  currency: string;
}

/** Shape stored in Membership.configuration (selections + service address/contact). */
export interface MembershipConfig {
  selections: Record<string, string | number | boolean | string[]>;
  quantity: number;
  address: { street: string; city: string; state: string; zip: string };
  contact: { name: string; email: string; phone: string | null };
}
