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

// ---------------------------------------------------------------------------
// Admin / coordinator screening surface
// ---------------------------------------------------------------------------

// Mirrors quotes.validation — triage state lives on the parent QuoteRequest.
const quoteStatus = z.enum(["NEW", "REVIEWING", "SENT", "WON", "LOST"]);

/** GET /admin/pm-requests — screening queue filters. */
export const listPmRequestsQuerySchema = z.object({
  status: quoteStatus.optional(),
  bundle: z.enum(["TURNOVER", "LISTING_PREP"]).optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const pmRequestIdParamSchema = z.object({ id: z.string().uuid() });

/** PATCH /admin/pm-requests/:id — set the coordinator's price and/or status. */
export const triagePmRequestSchema = z
  .object({
    quotedAmount: z.coerce.number().int().positive().max(5_000_000).optional(), // cents; same bound as quotes
    status: quoteStatus.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field is required" });
