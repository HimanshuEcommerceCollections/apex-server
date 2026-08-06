import { z } from "zod";
import { selectionsSchema } from "../../../shared";

export const configParamSchema = z.object({
  idOrSlug: z.string().min(1),
});

/** POST /services/:idOrSlug/config/price body (P14-M2 keyed selections; deviation 4). */
export const pricePreviewBodySchema = z.object({
  selections: selectionsSchema.optional().default({}),
  quantity: z.coerce.number().int().positive().optional(),
  /** Chosen payment frequency — its discount is applied to the preview total. */
  cadenceId: z.string().uuid().optional(),
});
