import type { z } from "zod";
import type { ContactMethod, PricingMode } from "../../enums";
import type { DisplayedPrice } from "../pricing";
import type { WaitlistSignupResponse } from "../waitlist/waitlist.types";
import type { createBookingSchema } from "./bookings.validation";

export type CreateBookingDto = z.infer<typeof createBookingSchema>;

export interface BookedCreateInput {
  customerId: string;
  serviceId: string;
  pricingMode: PricingMode;
  clientRequestId?: string | null;
  contact: {
    name: string;
    email: string;
    phone?: string | null;
    preferredMethod: ContactMethod;
    consentMarketing: boolean;
  };
  address: { street: string; city: string; state: string; zip: string };
  selections: Record<string, string | number | boolean | string[]>;
  quantity: number;
  description?: string | null;
  priced: DisplayedPrice | null;
  /** Charge snapshot: rate as-of-booking; amounts null for QUOTE until quoted. */
  tax: { taxRateBps: number; taxAmount: number | null; grandTotal: number | null };
  /** Payment frequency + the discount % actually applied, snapshotted. */
  cadence: { cadenceId: string; discountPercent: number };
  /** Set when this booking is a subscription's visit rather than a one-off. */
  membershipId?: string | null;
  notes?: string | null;
}

export interface BookedResult {
  outcome: "BOOKED";
  reference: string;
  booking_id: string;
  status: string;
  displayed_price: DisplayedPrice | null;
  next: string;
}

export interface WaitlistedResult {
  outcome: "WAITLISTED";
  waitlist_signup: WaitlistSignupResponse;
}

/**
 * The customer chose a recurring payment frequency, so this is a subscription
 * rather than a pay-at-booking booking. No Booking row exists yet — the first
 * visit is created by the invoice.paid webhook once Checkout completes.
 */
export interface CheckoutResult {
  outcome: "CHECKOUT";
  checkout_url: string;
  membership_id: string;
  cadence: { key: string; label: string; discountPercent: number };
}

export type BookingSubmitResult = BookedResult | WaitlistedResult | CheckoutResult;

export interface MyBookingSummary {
  reference: string;
  service: { slug: string; name: string } | null;
  status: string;
  quoteRequest: boolean;
  priceTotal: number | null;
  /** Charge snapshot (pre-tax total + tax + payable grand total). */
  taxAmount: number | null;
  grandTotal: number | null;
  /** Coordinator's binding amount for QUOTE bookings (pre-tax), once set. */
  quotedAmount: number | null;
  currency: string;
  /** The customer can start/resume payment right now. */
  canPay: boolean;
  /** The customer can cancel (unpaid FROM bookings only). */
  canCancel: boolean;
  paymentDueAt: string | null;
  scheduledAt: string | null;
  createdAt: string;
}

/** Decoupled from MyBookingSummary: the admin list doesn't carry customer payment affordances. */
export interface AdminBookingSummary {
  reference: string;
  service: { slug: string; name: string } | null;
  status: string;
  priceTotal: number | null;
  currency: string;
  scheduledAt: string | null;
  createdAt: string;
  customer: { id: string; name: string; email: string } | null;
  contactEmail: string;
  quoteRequest: boolean;
}
