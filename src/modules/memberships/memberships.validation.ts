import { z } from "zod";
import { selectionsSchema, zipSchema } from "../../shared";

const fromPriceField = z.coerce.number().int().min(0).max(2_000_000); // cents, ≤ $20,000

export const createPlanSchema = z.object({
  key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  serviceId: z.string().uuid(),
  interval: z.enum(["WEEK", "MONTH"]),
  intervalCount: z.coerce.number().int().positive().max(12).optional(),
  fromPrice: fromPriceField.optional(),
});

export const updatePlanSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    active: z.boolean().optional(),
    sortOrder: z.coerce.number().int().optional(),
    fromPrice: fromPriceField.nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field is required" });

export const planIdParamSchema = z.object({ id: z.string().uuid() });
export const membershipIdParamSchema = z.object({ id: z.string().uuid() });

export const subscribeSchema = z.object({
  planId: z.string().uuid(),
  selections: selectionsSchema.default({}),
  quantity: z.coerce.number().int().positive().optional(),
  address: z.object({
    street: z.string().trim().min(1).max(200),
    city: z.string().trim().min(1).max(120),
    state: z.string().trim().length(2).default("NC"),
    zip: zipSchema,
  }),
});
