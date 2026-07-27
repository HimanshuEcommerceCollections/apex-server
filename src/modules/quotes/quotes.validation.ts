import { z } from "zod";

const quoteStatus = z.enum(["NEW", "REVIEWING", "SENT", "WON", "LOST"]);

export const listQuotesQuerySchema = z.object({
  status: quoteStatus.optional(),
  source: z.enum(["BOOKING_FLOW", "PM_FORM"]).optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const quoteIdParamSchema = z.object({ id: z.string().uuid() });

/** Set the coordinator's final price (cents) and/or move the quote's status. */
export const updateQuoteSchema = z
  .object({
    quotedAmount: z.coerce.number().int().positive().max(5_000_000).optional(), // cents; bounded (MAX_QUOTE_CENTS)
    status: quoteStatus.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field is required" });
