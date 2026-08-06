/** Brand-level constants (docs/architecture/01 constants/brand.ts). */
export const BRAND_CODE = "APX";
export const PRICING_VERSION = "apex-pricing.v1";
/** Zero-pad width of the NNNN sequence in APX-YYYY-NNNN. */
export const REFERENCE_PAD = 4;

/** metadata.brand tag on every Apex Stripe object (07 §6.7 shared-account isolation). */
export const STRIPE_BRAND_TAG = "APEX";

/** Unpaid FROM bookings auto-cancel this many hours after entering AWAITING_PAYMENT. */
export const PAYMENT_WINDOW_HOURS = 24;
