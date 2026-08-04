import { z } from "zod";

const MAX_CENTS = 2_000_000; // $20,000 ceiling on any single delta / base price

export const catalogServiceParamSchema = z.object({ idOrSlug: z.string().min(1) });

export const updatePricingSchema = z
  .object({
    // FROM = binding, paid at booking; QUOTE = coordinator sets the final amount
    // (the engine total is indicative). Switching mode changes how /book charges.
    pricingMode: z.enum(["FROM", "QUOTE"]).optional(),
    // basePrice is the payable minimum AND the listed "from $X" (0 = none shown).
    basePrice: z.coerce.number().int().min(0).max(MAX_CENTS).optional(),
    typicalDuration: z.string().trim().max(40).nullable().optional(),
    recurringDiscount: z.string().trim().max(40).nullable().optional(),
    options: z
      .array(z.object({ id: z.string().uuid(), priceDelta: z.coerce.number().int().min(0).max(MAX_CENTS) }))
      .optional(),
    // Rule effect value: percent points (0-100) OR flat cents; the service caps
    // percent rules at 100 based on each rule's calc.
    rules: z
      .array(z.object({ id: z.string().uuid(), value: z.coerce.number().min(0).max(MAX_CENTS) }))
      .optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field is required" });

// Replace-all editor for a service's "Recurring plans" cards: send the heading +
// the full ordered plan list (row order = display order).
const recurringPlanSchema = z.object({
  name: z.string().trim().min(1).max(40),
  freq: z.string().trim().min(1).max(60),
  amount: z.string().trim().min(1).max(20),
  unit: z.string().trim().max(20).nullable().optional(),
  disc: z.string().trim().max(30).nullable().optional(),
  best: z.boolean().optional(),
  cta: z.string().trim().min(1).max(40),
});

export const replaceRecurringSchema = z.object({
  heading: z.string().trim().max(120).nullable().optional(),
  plans: z.array(recurringPlanSchema).max(8),
});
