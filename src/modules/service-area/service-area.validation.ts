import { z } from "zod";
import { zipSchema } from "../../shared";

export const validateQuerySchema = z.object({
  zip: zipSchema,
  service: z.string().trim().min(1).optional(), // id or slug; omit for a general zip-gate check
});

export const coverageParamSchema = z.object({
  serviceId: z.string().min(1), // id or slug
});

export const setCoverageBodySchema = z.object({
  areaIds: z.array(z.string().uuid()).default([]),
  zipOverrides: z
    .array(z.object({ zipCodeId: z.string().uuid(), effect: z.enum(["INCLUDE", "EXCLUDE"]) }))
    .default([]),
});
