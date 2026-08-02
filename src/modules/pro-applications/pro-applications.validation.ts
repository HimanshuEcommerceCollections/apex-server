import { z } from "zod";

/** POST /pro-applications — Become-an-Apex-Pro form. */
export const createProApplicationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().min(3).max(30).optional(),
  zip: z.string().regex(/^\d{5}$/, "zip must be a 5-digit ZIP code"),
  trades: z.array(z.string().trim().min(1)).min(1).max(20), // service slugs
  // Record<tradeSlug, Record<ackKey, boolean>> — collected, never verified (PRD).
  acknowledgements: z.record(z.string(), z.record(z.string(), z.boolean())).default({}),
  // Applicant profile from the form — display-only, all optional.
  experience: z.string().trim().max(60).optional(),
  company: z.string().trim().max(160).optional(),
  availability: z.string().trim().max(60).optional(),
  preferred_start: z.string().trim().max(60).optional(),
  intro: z.string().trim().max(4000).optional(),
});

// ---------------------------------------------------------------------------
// Admin / coordinator screening surface
// ---------------------------------------------------------------------------

const proStatus = z.enum(["RECEIVED", "REVIEWING", "CONTACTED"]);

/** GET /admin/pro-applications — screening queue filters. */
export const listProApplicationsQuerySchema = z.object({
  status: proStatus.optional(),
  trade: z.string().trim().min(1).max(60).optional(), // service slug
  search: z.string().trim().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const proApplicationIdParamSchema = z.object({ id: z.string().uuid() });

/** PATCH /admin/pro-applications/:id — advance the status and/or leave notes. */
export const screenProApplicationSchema = z
  .object({
    status: proStatus.optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field is required" });
