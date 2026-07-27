import { z } from "zod";

export const createAreaSchema = z.object({
  name: z.string().trim().min(2).max(120),
});

export const updateAreaSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field is required" });

export const listAreasQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  includeDeleted: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const areaIdParamSchema = z.object({ id: z.string().uuid() });
