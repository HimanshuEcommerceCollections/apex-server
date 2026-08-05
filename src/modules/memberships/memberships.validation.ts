import { z } from "zod";
import { selectionsSchema, zipSchema } from "../../shared";

// Plan create/update schemas left with the retired /admin/membership-plans API —
// plan lifecycle is the catalog module's (/admin/catalog/plans).

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
