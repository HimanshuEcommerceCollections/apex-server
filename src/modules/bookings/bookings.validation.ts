import { z } from "zod";
import { selectionsSchema, moneySchema, zipSchema } from "../../shared";

const contactMethod = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
  z.enum(["EMAIL", "PHONE", "SMS"]),
);

/** POST /bookings — the Core Flow submit (P14-M2 booking_request shape). */
export const createBookingSchema = z.object({
  request_id: z.string().uuid().optional(),
  service_type: z.string().min(1), // service slug or id; the server derives quote_request from its mode
  configuration: z.object({
    selections: selectionsSchema.default({}),
    quantity: z.coerce.number().int().positive().optional(),
    description: z.string().trim().max(2000).optional(),
  }),
  displayed_price: z
    .object({
      total: moneySchema,
      subtotal: moneySchema.optional(),
      pricing_version: z.string().optional(),
    })
    .optional(), // client echo — compared, never trusted
  contact: z.object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email(),
    phone: z.string().trim().min(3).max(30).optional(),
    preferred_method: contactMethod.optional(),
    consent_marketing: z.boolean().optional(),
  }),
  address: z.object({
    street: z.string().trim().min(1).max(200),
    city: z.string().trim().min(1).max(120),
    state: z.string().trim().length(2).default("NC"),
    zip: zipSchema,
  }),
  notes: z.string().trim().max(2000).optional(),
});

export const bookingReferenceParamSchema = z.object({
  reference: z.string().min(1),
});

// --- admin ---

const bookingStatus = z.enum([
  "DRAFT",
  "PENDING",
  "AWAITING_PAYMENT",
  "PAID",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
]);

export const listBookingsQuerySchema = z.object({
  status: bookingStatus.optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

/** Coordinator-driven transitions (not a full state machine in MVP). */
export const transitionBookingSchema = z
  .object({
    status: z.enum(["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
    scheduledAt: z.coerce.date().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field is required" });
