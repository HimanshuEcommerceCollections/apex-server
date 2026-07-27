import { z } from "zod";

const zip = z.string().regex(/^\d{5}$/, "zipCode must be a 5-digit ZIP code");

export const createZipSchema = z.object({
  areaId: z.string().uuid(),
  zipCode: zip,
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().length(2).optional(),
});

export const updateZipSchema = z
  .object({
    areaId: z.string().uuid().optional(),
    zipCode: zip.optional(),
    city: z.string().trim().max(120).nullable().optional(),
    state: z.string().trim().length(2).nullable().optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field is required" });

export const listZipsQuerySchema = z.object({
  areaId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  includeDeleted: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export const zipIdParamSchema = z.object({ id: z.string().uuid() });
