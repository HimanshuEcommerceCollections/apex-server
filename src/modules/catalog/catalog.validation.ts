import { z } from "zod";

const MAX_CENTS = 2_000_000; // $20,000 ceiling on any single delta / base price

export const catalogServiceParamSchema = z.object({ idOrSlug: z.string().min(1) });

export const updatePricingSchema = z
  .object({
    basePrice: z.coerce.number().int().min(0).max(MAX_CENTS).optional(),
    fromPrice: z.coerce.number().int().min(0).max(MAX_CENTS).nullable().optional(),
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
