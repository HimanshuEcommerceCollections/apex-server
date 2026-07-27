import { z } from "zod";
import { ServiceStatus } from "../../enums";

export const listServicesQuerySchema = z.object({
  status: z.nativeEnum(ServiceStatus).optional(),
  category: z.string().trim().optional(),
});

export const idOrSlugParamSchema = z.object({
  idOrSlug: z.string().min(1),
});
