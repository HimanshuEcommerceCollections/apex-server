import type { MembershipInterval, MembershipStatus } from "../../enums";

export interface PlanView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  interval: MembershipInterval;
  intervalCount: number;
  fromPrice: number | null;
  currency: string;
  active: boolean;
  service: { slug: string; name: string } | null;
}

export interface MembershipView {
  id: string;
  status: MembershipStatus;
  plan: { key: string; name: string } | null;
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
