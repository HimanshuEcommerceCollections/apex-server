import { z } from "zod";

const bundle = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toUpperCase().replace(/-/g, "_") : v),
  z.enum(["TURNOVER", "LISTING_PREP"]),
);

/** POST /pm-requests — property-manager B2B enquiry. */
export const createPmRequestSchema = z.object({
  company: z.string().trim().max(160).optional(),
  contact: z.object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email(),
    phone: z.string().trim().min(3).max(30).optional(),
  }),
  units_est: z.coerce.number().int().positive().max(100000),
  bundle,
  scope_notes: z.string().trim().min(1).max(4000),
});
