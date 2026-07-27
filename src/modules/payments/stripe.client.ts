import Stripe from "stripe";
import { env } from "../../config/env";
import { ApiError } from "../../utils/api-error";
import { STRIPE_BRAND_TAG } from "../../constants/brand";

let client: Stripe | null = null;

/** Lazily create the Stripe client; throws a clear 503 if payments aren't configured. */
export function getStripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw ApiError.serviceUnavailable("Payments are not configured", { code: "PAYMENTS_NOT_CONFIGURED" });
  }
  if (!client) client = new Stripe(env.STRIPE_SECRET_KEY);
  return client;
}

export function webhookSecret(): string {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw ApiError.serviceUnavailable("Stripe webhook is not configured", { code: "PAYMENTS_NOT_CONFIGURED" });
  }
  return env.STRIPE_WEBHOOK_SECRET;
}

/** Every Apex Stripe object is tagged so the shared account can be brand-partitioned (07 §6.7). */
export const brandMetadata = () => ({ brand: STRIPE_BRAND_TAG });

/** True only for objects Apex created (webhook gate + refund guard). */
export function isApexObject(metadata: Stripe.Metadata | null | undefined): boolean {
  return metadata?.brand === STRIPE_BRAND_TAG;
}

/** Namespaced idempotency keys so they can never collide with Elevate's on the shared account. */
export const idemKey = (suffix: string) => `apex_${suffix}`;
