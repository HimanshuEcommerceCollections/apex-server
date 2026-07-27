import { z } from "zod";
import { WaitlistSource } from "../../enums";

/**
 * The PRD publishes kebab wire values ("service-area-miss", "service-area-page");
 * map them onto the Prisma enum via z.preprocess. Bare enum values also pass for
 * internal callers (the booking pipeline's zip-miss arm).
 */
export const waitlistSourceSchema = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toUpperCase().replace(/-/g, "_") : v),
  z.nativeEnum(WaitlistSource),
);

export const createWaitlistSignupSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  zip: z.string().regex(/^\d{5}$/, "zip must be a 5-digit ZIP code"),
  source: waitlistSourceSchema.default(WaitlistSource.SERVICE_AREA_PAGE),
});
