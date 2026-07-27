import { z } from "zod";

/** POST /pro-applications — Become-an-Apex-Pro form. */
export const createProApplicationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().min(3).max(30).optional(),
  zip: z.string().regex(/^\d{5}$/, "zip must be a 5-digit ZIP code"),
  trades: z.array(z.string().trim().min(1)).min(1).max(20), // service slugs
  // Record<tradeSlug, Record<ackKey, boolean>> — collected, never verified (PRD).
  acknowledgements: z.record(z.string(), z.record(z.string(), z.boolean())).default({}),
});
